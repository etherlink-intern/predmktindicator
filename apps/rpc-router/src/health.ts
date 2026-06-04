import type { JsonRpcRequest } from "./rateLimit.js";

export type RpcTransport = (url: string, payload: JsonRpcRequest | JsonRpcRequest[], timeoutMs: number) => Promise<unknown>;

export type HealthProbeResult = {
  healthy: boolean;
  chainId?: string;
  blockNumber?: string;
  error?: string;
};

export async function probeEthereumProvider(
  url: string,
  rpcCall: RpcTransport,
  timeoutMs: number,
): Promise<HealthProbeResult> {
  try {
    const chainIdResponse = await rpcCall(
      url,
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      timeoutMs,
    );
    const chainId = extractResult(chainIdResponse);
    if (chainId !== "0x1") {
      return {
        healthy: false,
        chainId: typeof chainId === "string" ? chainId : undefined,
        error: `eth_chainId returned ${String(chainId)}, expected 0x1`,
      };
    }

    const blockNumberResponse = await rpcCall(
      url,
      { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
      timeoutMs,
    );
    const blockNumber = extractResult(blockNumberResponse);
    if (typeof blockNumber !== "string" || !/^0x[0-9a-f]+$/iu.test(blockNumber)) {
      return {
        healthy: false,
        chainId,
        error: `eth_blockNumber returned malformed value ${String(blockNumber)}`,
      };
    }

    return {
      healthy: true,
      chainId,
      blockNumber,
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractResult(response: unknown): unknown {
  if (typeof response !== "object" || response === null) {
    return undefined;
  }
  const record = response as Record<string, unknown>;
  if ("error" in record) {
    return undefined;
  }
  return record.result;
}
