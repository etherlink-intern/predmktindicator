#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "contracts", "fx-v2.json");
const primaryRpcUrl = process.env.RPC_ROUTER_URL || process.env.ETHEREUM_RPC_URL || "http://127.0.0.1:18545";
const rpcUrls = Array.from(
  new Set(
    (process.env.FX_CONTRACT_VERIFY_RPC_URLS
      ? process.env.FX_CONTRACT_VERIFY_RPC_URLS.split(",")
      : [
          primaryRpcUrl,
          "https://ethereum-rpc.publicnode.com",
          "https://eth.drpc.org",
          "https://rpc.mevblocker.io",
        ]
    )
      .map((url) => url.trim())
      .filter(Boolean),
  ),
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

async function rpc(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    throw new Error(`${method} HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} RPC error ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

async function rpcWithRetries(method, params, isUsable, description) {
  let lastResult;
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    for (const rpcUrl of rpcUrls) {
      try {
        const result = await rpc(rpcUrl, method, params);
        lastResult = result;
        if (isUsable(result)) {
          return result;
        }
      } catch (error) {
        lastError = error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }

  if (lastError) {
    throw new Error(`${description} failed after retries: ${lastError.message}`);
  }
  throw new Error(`${description} unavailable after retries; last result ${JSON.stringify(lastResult)}`);
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert(manifest.chain?.chainId === 1, "manifest chain.chainId must be 1");
  assert(Array.isArray(manifest.activeIndexTargets), "manifest activeIndexTargets must be an array");

  const seenAddresses = new Map();
  for (const contract of manifest.activeIndexTargets) {
    assert(contract.name, "contract is missing name");
    assert(isAddress(contract.address), `${contract.name} has invalid address ${contract.address}`);
    assert(Number.isInteger(contract.startBlock) && contract.startBlock > 0, `${contract.name} has invalid startBlock`);
    assert(contract.abiPath, `${contract.name} is missing abiPath`);
    assert(Array.isArray(contract.events) && contract.events.length > 0, `${contract.name} has no events`);

    const previous = seenAddresses.get(contract.address.toLowerCase());
    assert(!previous, `${contract.name} duplicates address already used by ${previous}`);
    seenAddresses.set(contract.address.toLowerCase(), contract.name);

    const abiPath = path.join(root, contract.abiPath);
    assert(fs.existsSync(abiPath), `${contract.name} abiPath does not exist: ${contract.abiPath}`);
    const abi = JSON.parse(fs.readFileSync(abiPath, "utf8"));
    assert(Array.isArray(abi), `${contract.name} ABI must be an array`);
    const eventNames = new Set(abi.filter((entry) => entry.type === "event").map((entry) => entry.name));
    for (const eventName of contract.events) {
      assert(eventNames.has(eventName), `${contract.name} event ${eventName} missing from ${contract.abiPath}`);
    }

    const code = await rpcWithRetries(
      "eth_getCode",
      [contract.address, "latest"],
      (result) => typeof result === "string" && result !== "0x" && result.length > 10,
      `${contract.name} code lookup`,
    );
    assert(typeof code === "string" && code !== "0x" && code.length > 10, `${contract.name} has no code at ${contract.address}`);

    if (contract.deploymentTransactionHash) {
      const receipt = await rpcWithRetries(
        "eth_getTransactionReceipt",
        [contract.deploymentTransactionHash],
        (result) => result && typeof result.blockNumber === "string" && result.status === "0x1",
        `${contract.name} deployment receipt lookup`,
      );
      assert(receipt, `${contract.name} deployment receipt not found`);
      const receiptBlock = Number.parseInt(receipt.blockNumber, 16);
      assert(receiptBlock === contract.startBlock, `${contract.name} startBlock ${contract.startBlock} != receipt block ${receiptBlock}`);
      assert(receipt.status === "0x1", `${contract.name} deployment tx did not succeed`);
    }

    console.log(`OK ${contract.name} ${contract.address} start=${contract.startBlock}`);
  }

  for (const ref of manifest.legacyMarketReferences || []) {
    assert(isAddress(ref.address), `legacy reference ${ref.name} has invalid address ${ref.address}`);
  }

  console.log(`Verified ${manifest.activeIndexTargets.length} active f(x) contract targets via ${rpcUrls.join(", ")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
