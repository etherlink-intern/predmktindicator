import http from "node:http";
import { ProviderPool, RpcRouterError, rpcErrorResponseFromError, statusCodeFromError } from "./providerPool.js";

type JsonBody = Record<string, unknown> | unknown[];

const pool = new ProviderPool();
const port = readInt(process.env.PORT ?? process.env.RPC_ROUTER_PORT, 8545, 1, 65_535);
const host = process.env.RPC_ROUTER_HOST ?? "0.0.0.0";
const maxBodyBytes = readInt(process.env.RPC_MAX_BODY_BYTES, 1_000_000, 1_024, 20_000_000);

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      await handleHealth(response);
      return;
    }

    if (request.method !== "POST" || request.url !== "/") {
      writeJson(response, 404, { error: "not found" });
      return;
    }

    const payload = await readJsonBody(request, maxBodyBytes);
    const rpcResponse = await pool.forward(payload);
    writeJson(response, 200, rpcResponse);
  } catch (error) {
    writeJson(response, statusCodeFromError(error), rpcErrorResponseFromError(error, requestIdFromBodyError(error)));
  }
});

pool
  .initialize()
  .catch((error) => {
    console.error("rpc-router initial provider refresh failed", error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    server.listen(port, host, () => {
      console.log(`rpc-router listening on ${host}:${port}`);
    });
  });

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function handleHealth(response: http.ServerResponse): Promise<void> {
  const stats = pool.getStats();
  const statusCode = stats.status === "unavailable" ? 503 : 200;
  writeJson(response, statusCode, {
    service: "rpc-router",
    status: stats.status,
    totalProviders: stats.totalProviders,
    healthyProviders: stats.healthyProviders,
    coolingDownProviders: stats.coolingDownProviders,
    providers: stats.providers,
  });
}

function writeJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: http.IncomingMessage, maxBytes: number): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new RpcRouterError(`request body exceeds ${maxBytes} bytes`, {
        statusCode: 413,
        code: -32005,
      });
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonBody;
  } catch {
    throw new RpcRouterError("invalid JSON request body", {
      statusCode: 400,
      code: -32700,
    });
  }
}

function requestIdFromBodyError(_error: unknown): null {
  return null;
}

function readInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function shutdown(): void {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
