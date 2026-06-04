import assert from "node:assert/strict";
import test from "node:test";
import { parseChainListRpcs } from "./chainlist.js";
import { ProviderPool, RpcRouterError, type ProviderPoolOptions } from "./providerPool.js";
import type { JsonRpcRequest } from "./rateLimit.js";

function requestMethod(payload: JsonRpcRequest | JsonRpcRequest[]): string {
  return Array.isArray(payload) ? payload[0]?.method ?? "" : payload.method;
}

function requestId(payload: JsonRpcRequest | JsonRpcRequest[]): string | number | null | undefined {
  return Array.isArray(payload) ? payload[0]?.id : payload.id;
}

function makePool(options: ProviderPoolOptions): ProviderPool {
  return new ProviderPool({
    skipDynamicEndpoints: true,
    ...options,
  });
}

test("rotates healthy providers round-robin", async () => {
  const forwardedUrls: string[] = [];
  const pool = makePool({
    env: {
      ETHEREUM_RPC_URL: "https://one.example/rpc",
      ETHEREUM_RPC_FALLBACK_URLS: "https://two.example/rpc",
      RPC_MAX_RETRIES: "0",
    },
    rpcCall: async (url, payload) => {
      const method = requestMethod(payload);
      if (method === "eth_chainId") {
        return { jsonrpc: "2.0", id: requestId(payload), result: "0x1" };
      }
      if (method === "eth_blockNumber") {
        if (requestId(payload) === 2) {
          return { jsonrpc: "2.0", id: requestId(payload), result: "0x10" };
        }
        forwardedUrls.push(url);
        return { jsonrpc: "2.0", id: requestId(payload), result: "0x10" };
      }
      return { jsonrpc: "2.0", id: requestId(payload), result: "0x10" };
    },
  });

  await pool.initialize();
  forwardedUrls.length = 0;

  await pool.forward({ jsonrpc: "2.0", id: 11, method: "eth_blockNumber", params: [] });
  await pool.forward({ jsonrpc: "2.0", id: 12, method: "eth_blockNumber", params: [] });

  assert.deepEqual(forwardedUrls, ["https://one.example/rpc", "https://two.example/rpc"]);
});

test("cools down a provider on retryable failure and retries idempotent reads", async () => {
  let now = 1_000;
  const forwardedUrls: string[] = [];
  const pool = makePool({
    env: {
      ETHEREUM_RPC_URL: "https://bad.example/rpc",
      ETHEREUM_RPC_FALLBACK_URLS: "https://good.example/rpc",
      RPC_PROVIDER_COOLDOWN_SECONDS: "60",
      RPC_MAX_RETRIES: "1",
    },
    now: () => now,
    rpcCall: async (url, payload) => {
      const method = requestMethod(payload);
      if (method === "eth_chainId") {
        return { jsonrpc: "2.0", id: requestId(payload), result: "0x1" };
      }
      if (method === "eth_blockNumber" && requestId(payload) === 2) {
        return { jsonrpc: "2.0", id: requestId(payload), result: "0x20" };
      }
      forwardedUrls.push(url);
      if (url.includes("bad.example")) {
        throw new RpcRouterError("HTTP 429", { statusCode: 502, code: -32005, retryable: true });
      }
      return { jsonrpc: "2.0", id: requestId(payload), result: "0x21" };
    },
  });

  await pool.initialize();
  const response = await pool.forward({ jsonrpc: "2.0", id: 44, method: "eth_blockNumber", params: [] });

  assert.deepEqual(forwardedUrls, ["https://bad.example/rpc", "https://good.example/rpc"]);
  assert.deepEqual(response, { jsonrpc: "2.0", id: 44, result: "0x21" });
  const bad = pool.getProviderStatesForTest().find((provider) => provider.url.includes("bad.example"));
  assert.ok(bad);
  if (!bad) {
    throw new Error("bad provider missing");
  }
  assert.equal(bad.healthy, false);
  assert.equal(bad.cooldownUntil, now + 60_000);
});

test("rejects providers that report the wrong chainId", async () => {
  const pool = makePool({
    env: {
      ETHEREUM_RPC_URL: "https://wrong-chain.example/rpc",
      ETHEREUM_RPC_FALLBACK_URLS: "https://mainnet.example/rpc",
    },
    rpcCall: async (url, payload) => {
      const method = requestMethod(payload);
      if (method === "eth_chainId") {
        return { jsonrpc: "2.0", id: requestId(payload), result: url.includes("wrong-chain") ? "0x5" : "0x1" };
      }
      return { jsonrpc: "2.0", id: requestId(payload), result: "0x30" };
    },
  });

  await pool.initialize();

  const states = pool.getProviderStatesForTest();
  assert.equal(states.length, 2);
  assert.equal(states.find((provider) => provider.url.includes("wrong-chain"))?.healthy, false);
  assert.equal(states.find((provider) => provider.url.includes("mainnet"))?.healthy, true);
  assert.equal(pool.getStats().healthyProviders, 1);
});

test("filters placeholders and private ChainList URLs while preserving tracking preference", () => {
  const candidates = parseChainListRpcs([
    {
      chainId: 1,
      rpc: [
        { url: "https://mainnet.infura.io/v3/${INFURA_API_KEY}", tracking: "none" },
        { url: "http://not-https.example/rpc", tracking: "none" },
        { url: "https://localhost:8545", tracking: "none" },
        { url: "https://10.0.0.4/rpc", tracking: "none" },
        { url: "https://public.example/rpc", tracking: "yes" },
        { url: "https://privacy.example/rpc", tracking: "none" },
        { url: "https://public.example/rpc/", tracking: "limited" },
      ],
    },
    { chainId: 10, rpc: ["https://optimism.example/rpc"] },
  ]);

  assert.deepEqual(
    candidates.map((candidate) => ({ url: candidate.url, tracking: candidate.tracking })),
    [
      { url: "https://privacy.example/rpc", tracking: "none" },
      { url: "https://public.example/rpc", tracking: "limited" },
    ],
  );
});

test("rejects eth_getLogs ranges above configured maximum before forwarding", async () => {
  let rpcCalls = 0;
  const pool = makePool({
    env: {
      ETHEREUM_RPC_URL: "https://mainnet.example/rpc",
      RPC_MAX_GET_LOGS_BLOCK_RANGE: "2000",
    },
    skipInitialHealthCheck: true,
    rpcCall: async (_url, payload) => {
      rpcCalls += 1;
      return { jsonrpc: "2.0", id: requestId(payload), result: [] };
    },
  });

  await assert.rejects(
    () =>
      pool.forward({
        jsonrpc: "2.0",
        id: 99,
        method: "eth_getLogs",
        params: [{ fromBlock: "0x1", toBlock: "0x1000" }],
      }),
    /eth_getLogs block range exceeds 2000/,
  );
  assert.equal(rpcCalls, 0);
});

test("caps dynamic providers while preserving manual endpoints", async () => {
  const pool = new ProviderPool({
    env: {
      ETHEREUM_RPC_URL: "https://manual.example/rpc",
      RPC_MAX_DYNAMIC_PROVIDERS: "2",
    },
    skipInitialHealthCheck: true,
    fetchFn: async (url) => {
      const body = String(url).includes("chainlist")
        ? [
            {
              chainId: 1,
              rpc: [
                { url: "https://one.example/rpc", tracking: "none" },
                { url: "https://two.example/rpc", tracking: "none" },
                { url: "https://three.example/rpc", tracking: "none" },
              ],
            },
          ]
        : { chainId: 1, rpc: ["https://four.example/rpc"] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await pool.initialize();

  assert.deepEqual(
    pool.getProviderStatesForTest().map((provider) => provider.url),
    ["https://manual.example/rpc", "https://one.example/rpc", "https://three.example/rpc"],
  );
});

test("marks providers stale when block lag exceeds threshold", async () => {
  const pool = makePool({
    env: {
      ETHEREUM_RPC_URL: "https://fresh.example/rpc",
      ETHEREUM_RPC_FALLBACK_URLS: "https://stale.example/rpc",
      RPC_MAX_BLOCK_LAG: "16",
    },
    rpcCall: async (url, payload) => {
      const method = requestMethod(payload);
      if (method === "eth_chainId") {
        return { jsonrpc: "2.0", id: requestId(payload), result: "0x1" };
      }
      if (method === "eth_blockNumber") {
        return { jsonrpc: "2.0", id: requestId(payload), result: url.includes("stale") ? "0x100" : "0x200" };
      }
      return { jsonrpc: "2.0", id: requestId(payload), result: null };
    },
  });

  await pool.initialize();

  const stale = pool.getProviderStatesForTest().find((provider) => provider.url.includes("stale"));
  assert.equal(stale?.healthy, false);
  assert.match(stale?.lastError ?? "", /block lag/);
  assert.equal(pool.getStats().healthyProviders, 1);
});

test("rejects unbounded eth_getLogs requests before forwarding", async () => {
  let rpcCalls = 0;
  const pool = makePool({
    env: {
      ETHEREUM_RPC_URL: "https://mainnet.example/rpc",
    },
    skipInitialHealthCheck: true,
    rpcCall: async (_url, payload) => {
      rpcCalls += 1;
      return { jsonrpc: "2.0", id: requestId(payload), result: [] };
    },
  });

  await assert.rejects(
    () =>
      pool.forward({
        jsonrpc: "2.0",
        id: 100,
        method: "eth_getLogs",
        params: [{ fromBlock: "0x1", toBlock: "latest" }],
      }),
    /requires numeric fromBlock and toBlock/,
  );
  await assert.rejects(
    () =>
      pool.forward({
        jsonrpc: "2.0",
        id: 101,
        method: "eth_getLogs",
        params: [],
      }),
    /requires a filter object/,
  );
  await assert.rejects(
    () =>
      pool.forward({
        jsonrpc: "2.0",
        id: 102,
        method: "eth_getLogs",
      }),
    /requires a filter object/,
  );
  assert.equal(rpcCalls, 0);
});

test("retries retryable JSON-RPC provider errors for idempotent requests", async () => {
  const forwardedUrls: string[] = [];
  const pool = makePool({
    env: {
      ETHEREUM_RPC_URL: "https://aaa-limited.example/rpc",
      ETHEREUM_RPC_FALLBACK_URLS: "https://good.example/rpc",
      RPC_MAX_RETRIES: "1",
    },
    skipInitialHealthCheck: true,
    rpcCall: async (url, payload) => {
      forwardedUrls.push(url);
      if (url.includes("limited")) {
        return {
          jsonrpc: "2.0",
          id: requestId(payload),
          error: { code: -32005, message: "rate limit exceeded" },
        };
      }
      return { jsonrpc: "2.0", id: requestId(payload), result: "0x1" };
    },
  });

  const response = await pool.forward({ jsonrpc: "2.0", id: 101, method: "eth_chainId", params: [] });

  assert.deepEqual(forwardedUrls, ["https://aaa-limited.example/rpc", "https://good.example/rpc"]);
  assert.deepEqual(response, { jsonrpc: "2.0", id: 101, result: "0x1" });
});

test("does not retry non-idempotent transaction sends", async () => {
  let rpcCalls = 0;
  const pool = makePool({
    env: {
      ETHEREUM_RPC_URL: "https://aaa-limited.example/rpc",
      ETHEREUM_RPC_FALLBACK_URLS: "https://good.example/rpc",
      RPC_MAX_RETRIES: "3",
    },
    skipInitialHealthCheck: true,
    rpcCall: async (_url, payload) => {
      rpcCalls += 1;
      return {
        jsonrpc: "2.0",
        id: requestId(payload),
        error: { code: -32005, message: "rate limit exceeded" },
      };
    },
  });

  await assert.rejects(
    () =>
      pool.forward({
        jsonrpc: "2.0",
        id: 102,
        method: "eth_sendRawTransaction",
        params: ["0xdeadbeef"],
      }),
    /rate limit exceeded/,
  );
  assert.equal(rpcCalls, 1);
});
