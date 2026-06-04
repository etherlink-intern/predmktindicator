export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export type GuardOptions = {
  maxBatchSize: number;
  maxGetLogsBlockRange: number;
};

export class RpcGuardError extends Error {
  readonly code: number;
  readonly statusCode: number;
  readonly data?: unknown;

  constructor(message: string, code = -32600, statusCode = 400, data?: unknown) {
    super(message);
    this.name = "RpcGuardError";
    this.code = code;
    this.statusCode = statusCode;
    this.data = data;
  }
}

export function validateRpcPayload(payload: unknown, options: GuardOptions): JsonRpcRequest | JsonRpcRequest[] {
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      throw new RpcGuardError("JSON-RPC batch must not be empty");
    }
    if (payload.length > options.maxBatchSize) {
      throw new RpcGuardError(`JSON-RPC batch size exceeds ${options.maxBatchSize}`, -32005, 413);
    }
    return payload.map((request) => validateSingleRpcRequest(request, options));
  }

  return validateSingleRpcRequest(payload, options);
}

export function validateSingleRpcRequest(payload: unknown, options: GuardOptions): JsonRpcRequest {
  if (!isRecord(payload) || typeof payload.method !== "string" || payload.method.length === 0) {
    throw new RpcGuardError("Invalid JSON-RPC request");
  }

  const request = payload as JsonRpcRequest;
  if (isRejectedMethod(request.method)) {
    throw new RpcGuardError(`RPC method ${request.method} is disabled by router policy`, -32601, 403);
  }

  if (request.method === "eth_getLogs") {
    enforceGetLogsRange(request, options.maxGetLogsBlockRange);
  }

  return request;
}

export function isRejectedMethod(method: string): boolean {
  const lower = method.toLowerCase();
  return lower.startsWith("debug_") || lower.startsWith("trace_") || lower === "trace";
}

export function isIdempotentRpcPayload(payload: JsonRpcRequest | JsonRpcRequest[]): boolean {
  const requests = Array.isArray(payload) ? payload : [payload];
  return requests.every((request) => isIdempotentMethod(request.method));
}

export function isIdempotentMethod(method: string): boolean {
  if (method === "eth_sendRawTransaction" || method === "eth_sendTransaction") {
    return false;
  }

  return (
    method === "eth_chainId" ||
    method === "eth_blockNumber" ||
    method === "eth_call" ||
    method === "eth_estimateGas" ||
    method === "eth_gasPrice" ||
    method === "eth_feeHistory" ||
    method === "eth_getBalance" ||
    method === "eth_getCode" ||
    method === "eth_getLogs" ||
    method === "eth_getStorageAt" ||
    method === "eth_getTransactionByHash" ||
    method === "eth_getTransactionCount" ||
    method === "eth_getTransactionReceipt" ||
    method === "eth_getBlockByHash" ||
    method === "eth_getBlockByNumber" ||
    method === "eth_getBlockReceipts" ||
    method === "eth_maxPriorityFeePerGas" ||
    method === "eth_syncing" ||
    method === "net_version" ||
    method === "web3_clientVersion" ||
    method.startsWith("eth_get") ||
    method.startsWith("net_") ||
    method.startsWith("web3_")
  );
}

export function makeJsonRpcError(id: JsonRpcId | undefined, error: JsonRpcErrorObject): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error,
  };
}

function enforceGetLogsRange(request: JsonRpcRequest, maxRange: number): void {
  const [filter] = Array.isArray(request.params) ? request.params : [];
  if (!isRecord(filter)) {
    throw new RpcGuardError(
      "eth_getLogs requires a filter object with numeric fromBlock and toBlock",
      -32602,
      400,
      { maxRange },
    );
  }

  const fromBlock = parseBlockTag(filter.fromBlock);
  const toBlock = parseBlockTag(filter.toBlock);

  if (fromBlock === undefined || toBlock === undefined) {
    throw new RpcGuardError(
      "eth_getLogs requires numeric fromBlock and toBlock within the configured range",
      -32602,
      400,
      { maxRange },
    );
  }

  if (toBlock < fromBlock) {
    throw new RpcGuardError("eth_getLogs toBlock must be greater than or equal to fromBlock", -32602, 400);
  }

  const range = toBlock - fromBlock;
  if (range > BigInt(maxRange)) {
    throw new RpcGuardError(`eth_getLogs block range exceeds ${maxRange}`, -32005, 413, {
      fromBlock: filter.fromBlock,
      toBlock: filter.toBlock,
      maxRange,
    });
  }
}

function parseBlockTag(value: unknown): bigint | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  if (/^0x[0-9a-f]+$/iu.test(value)) {
    return BigInt(value);
  }
  if (/^[0-9]+$/u.test(value)) {
    return BigInt(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
