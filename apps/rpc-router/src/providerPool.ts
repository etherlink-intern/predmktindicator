import dns from "node:dns/promises";
import net from "node:net";
import {
  dedupeAndSortCandidates,
  isPrivateOrInternalHost,
  loadDynamicEndpointCandidates,
  parseManualEndpoints,
  type FetchLike,
  type ProviderCandidate,
} from "./chainlist.js";
import { probeEthereumProvider, type RpcTransport } from "./health.js";
import {
  isIdempotentRpcPayload,
  makeJsonRpcError,
  RpcGuardError,
  validateRpcPayload,
  type JsonRpcRequest,
} from "./rateLimit.js";

export type ProviderState = ProviderCandidate & {
  healthy: boolean;
  cooldownUntil: number;
  failures: number;
  successes: number;
  lastCheckedAt?: number;
  lastBlockNumber?: string;
  lastError?: string;
};

export type ProviderPoolOptions = {
  env?: NodeJS.ProcessEnv;
  fetchFn?: FetchLike;
  rpcCall?: RpcTransport;
  now?: () => number;
  skipDynamicEndpoints?: boolean;
  skipInitialHealthCheck?: boolean;
};

export type ProviderPoolStats = {
  status: "ok" | "degraded" | "unavailable";
  totalProviders: number;
  healthyProviders: number;
  coolingDownProviders: number;
  candidates: number;
  providers: Array<{
    url: string;
    source: ProviderCandidate["source"];
    tracking: ProviderCandidate["tracking"];
    healthy: boolean;
    coolingDown: boolean;
    failures: number;
    successes: number;
    lastCheckedAt?: string;
    lastBlockNumber?: string;
    lastError?: string;
  }>;
};

export class RpcRouterError extends Error {
  readonly statusCode: number;
  readonly code: number;
  readonly retryable: boolean;
  readonly data?: unknown;

  constructor(message: string, options: { statusCode?: number; code?: number; retryable?: boolean; data?: unknown } = {}) {
    super(message);
    this.name = "RpcRouterError";
    this.statusCode = options.statusCode ?? 502;
    this.code = options.code ?? -32000;
    this.retryable = options.retryable ?? false;
    this.data = options.data;
  }
}

export class ProviderPool {
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchFn?: FetchLike;
  private readonly rpcCall: RpcTransport;
  private readonly now: () => number;
  private readonly skipDynamicEndpoints: boolean;
  private readonly skipInitialHealthCheck: boolean;
  private providers: ProviderState[] = [];
  private candidatesCount = 0;
  private rotationIndex = 0;
  private initialized = false;

  readonly timeoutMs: number;
  readonly cooldownMs: number;
  readonly maxRetries: number;
  readonly maxGetLogsBlockRange: number;
  readonly maxBatchSize: number;
  readonly endpointCacheTtlMs: number;
  readonly maxDynamicProviders: number;
  readonly maxProviders: number;
  readonly maxHealthCheckConcurrency: number;
  readonly maxBlockLag: number;
  readonly chainlistUrl: string;
  readonly chainidUrl: string;

  constructor(options: ProviderPoolOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchFn = options.fetchFn;
    this.rpcCall = options.rpcCall ?? defaultRpcCall;
    this.now = options.now ?? (() => Date.now());
    this.skipDynamicEndpoints = options.skipDynamicEndpoints ?? false;
    this.skipInitialHealthCheck = options.skipInitialHealthCheck ?? false;

    this.timeoutMs = readInt(this.env.RPC_TIMEOUT_MS, 8_000, 1, 120_000);
    this.cooldownMs = readInt(this.env.RPC_PROVIDER_COOLDOWN_SECONDS, 60, 1, 3_600) * 1_000;
    this.maxRetries = readInt(this.env.RPC_MAX_RETRIES, 2, 0, 10);
    this.maxGetLogsBlockRange = readInt(this.env.RPC_MAX_GET_LOGS_BLOCK_RANGE, 2_000, 1, 1_000_000);
    this.maxBatchSize = readInt(this.env.RPC_MAX_BATCH_SIZE, 20, 1, 1_000);
    this.endpointCacheTtlMs = readInt(this.env.RPC_ENDPOINT_CACHE_TTL_SECONDS, 3_600, 60, 86_400) * 1_000;
    this.maxDynamicProviders = readInt(this.env.RPC_MAX_DYNAMIC_PROVIDERS, 24, 0, 250);
    this.maxProviders = readInt(this.env.RPC_MAX_PROVIDERS, 32, 1, 300);
    this.maxHealthCheckConcurrency = readInt(this.env.RPC_HEALTH_CHECK_CONCURRENCY, 8, 1, 64);
    this.maxBlockLag = readInt(this.env.RPC_MAX_BLOCK_LAG, 128, 0, 100_000);
    this.chainlistUrl = this.env.CHAINLIST_RPC_SOURCE_URL ?? "https://chainlist.org/rpcs.json";
    this.chainidUrl = this.env.CHAINID_RPC_SOURCE_URL ?? "https://chainid.network/chains/eip155-1.json";
  }

  async initialize(forceRefresh = false): Promise<void> {
    await this.refreshProviders(forceRefresh);
    if (!this.skipInitialHealthCheck) {
      await this.healthCheckAll();
    }
    this.initialized = true;
  }

  async refreshProviders(forceRefresh = false): Promise<void> {
    const manualCandidates = parseManualEndpoints(this.env);
    const dynamicCandidates = this.skipDynamicEndpoints
      ? []
      : await loadDynamicEndpointCandidates(
          {
            chainlistUrl: this.chainlistUrl,
            chainidUrl: this.chainidUrl,
            ttlMs: this.endpointCacheTtlMs,
            fetchFn: this.fetchFn,
            now: this.now,
          },
          forceRefresh,
        ).catch(() => []);

    const limitedDynamicCandidates = this.maxDynamicProviders > 0 ? dynamicCandidates.slice(0, this.maxDynamicProviders) : [];
    const candidates = dedupeAndSortCandidates([...manualCandidates, ...limitedDynamicCandidates]).slice(0, this.maxProviders);
    this.candidatesCount = candidates.length;

    const existing = new Map(this.providers.map((provider) => [provider.normalizedUrl, provider]));
    this.providers = candidates.map((candidate) => {
      const previous = existing.get(candidate.normalizedUrl);
      return {
        ...candidate,
        healthy: previous?.healthy ?? this.skipInitialHealthCheck,
        cooldownUntil: previous?.cooldownUntil ?? 0,
        failures: previous?.failures ?? 0,
        successes: previous?.successes ?? 0,
        lastCheckedAt: previous?.lastCheckedAt,
        lastBlockNumber: previous?.lastBlockNumber,
        lastError: previous?.lastError,
      };
    });
  }

  async healthCheckAll(): Promise<void> {
    await mapWithConcurrency(this.providers, this.maxHealthCheckConcurrency, (provider) =>
      this.healthCheckProvider(provider),
    );
    this.markStaleProvidersUnhealthy();
  }

  async healthCheckProvider(provider: ProviderState): Promise<boolean> {
    const checkedAt = this.now();
    const result = await probeEthereumProvider(provider.url, this.rpcCall, this.timeoutMs);
    provider.lastCheckedAt = checkedAt;
    provider.healthy = result.healthy;
    provider.lastBlockNumber = result.blockNumber;
    provider.lastError = result.error;
    if (result.healthy) {
      provider.cooldownUntil = 0;
      provider.successes += 1;
      return true;
    }

    provider.failures += 1;
    return false;
  }

  async forward(payload: unknown): Promise<unknown> {
    const guardedPayload = validateRpcPayload(payload, {
      maxBatchSize: this.maxBatchSize,
      maxGetLogsBlockRange: this.maxGetLogsBlockRange,
    });

    if (!this.initialized) {
      await this.initialize();
    }

    const idempotent = isIdempotentRpcPayload(guardedPayload);
    const attempts = idempotent ? this.maxRetries + 1 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const provider = await this.nextProvider();
      if (!provider) {
        break;
      }

      try {
        const response = await this.rpcCall(provider.url, guardedPayload, this.timeoutMs);
        throwIfRetryableJsonRpcError(response);
        this.markSuccess(provider);
        return response;
      } catch (error) {
        lastError = error;
        this.markFailure(provider, error);
        if (!idempotent || !isRetryableTransportError(error)) {
          break;
        }
      }
    }

    if (lastError instanceof RpcRouterError) {
      throw lastError;
    }
    if (lastError instanceof RpcGuardError) {
      throw new RpcRouterError(lastError.message, {
        statusCode: lastError.statusCode,
        code: lastError.code,
        data: lastError.data,
      });
    }

    throw new RpcRouterError("No healthy Ethereum RPC providers available", {
      statusCode: 503,
      code: -32002,
      retryable: true,
    });
  }

  getStats(): ProviderPoolStats {
    const now = this.now();
    const healthyProviders = this.providers.filter((provider) => provider.healthy && provider.cooldownUntil <= now).length;
    const coolingDownProviders = this.providers.filter((provider) => provider.cooldownUntil > now).length;
    const status = healthyProviders > 0 ? (healthyProviders === this.providers.length ? "ok" : "degraded") : "unavailable";

    return {
      status,
      totalProviders: this.providers.length,
      healthyProviders,
      coolingDownProviders,
      candidates: this.candidatesCount,
      providers: this.providers.map((provider) => ({
        url: redactUrl(provider.url),
        source: provider.source,
        tracking: provider.tracking,
        healthy: provider.healthy,
        coolingDown: provider.cooldownUntil > now,
        failures: provider.failures,
        successes: provider.successes,
        lastCheckedAt: provider.lastCheckedAt ? new Date(provider.lastCheckedAt).toISOString() : undefined,
        lastBlockNumber: provider.lastBlockNumber,
        lastError: provider.lastError ? redactSecretsInText(provider.lastError) : undefined,
      })),
    };
  }

  getProviderStatesForTest(): readonly ProviderState[] {
    return this.providers;
  }

  private async nextProvider(): Promise<ProviderState | undefined> {
    const now = this.now();
    let eligible = this.providers.filter((provider) => provider.healthy && provider.cooldownUntil <= now);

    if (eligible.length === 0) {
      await this.healthCheckAll();
      eligible = this.providers.filter((provider) => provider.healthy && provider.cooldownUntil <= this.now());
    }

    if (eligible.length === 0) {
      await this.refreshProviders(false);
      if (!this.skipInitialHealthCheck) {
        await this.healthCheckAll();
      }
      eligible = this.providers.filter((provider) => provider.healthy && provider.cooldownUntil <= this.now());
    }

    if (eligible.length === 0) {
      return undefined;
    }

    const provider = eligible[this.rotationIndex % eligible.length];
    this.rotationIndex = (this.rotationIndex + 1) % Number.MAX_SAFE_INTEGER;
    return provider;
  }

  private markSuccess(provider: ProviderState): void {
    provider.healthy = true;
    provider.cooldownUntil = 0;
    provider.successes += 1;
    provider.lastError = undefined;
  }

  private markFailure(provider: ProviderState, error: unknown): void {
    provider.failures += 1;
    provider.healthy = false;
    provider.cooldownUntil = this.now() + this.cooldownMs;
    provider.lastError = error instanceof Error ? error.message : String(error);
  }

  private markStaleProvidersUnhealthy(): void {
    const healthyBlocks = this.providers
      .filter((provider) => provider.healthy && provider.lastBlockNumber)
      .map((provider) => parseHexBlockNumber(provider.lastBlockNumber))
      .filter((block): block is bigint => block !== undefined);

    if (this.maxBlockLag === 0 || healthyBlocks.length === 0) {
      return;
    }

    const head = healthyBlocks.reduce((max, block) => (block > max ? block : max), 0n);
    const allowedLag = BigInt(this.maxBlockLag);
    for (const provider of this.providers) {
      const block = parseHexBlockNumber(provider.lastBlockNumber);
      if (!provider.healthy || block === undefined) {
        continue;
      }
      const lag = head - block;
      if (lag > allowedLag) {
        provider.healthy = false;
        provider.failures += 1;
        provider.lastError = `provider block lag ${lag.toString()} exceeds ${this.maxBlockLag}`;
      }
    }
  }
}

export async function defaultRpcCall(
  url: string,
  payload: JsonRpcRequest | JsonRpcRequest[],
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await assertPublicRpcTarget(url);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: controller.signal,
    });

    const text = await response.text();
    if (response.status >= 300 && response.status < 400) {
      throw new RpcRouterError(`Provider redirect blocked with HTTP ${response.status}`, {
        statusCode: 502,
        code: -32000,
        retryable: false,
      });
    }
    if (response.status === 429 || response.status >= 500) {
      throw new RpcRouterError(`Provider HTTP ${response.status}`, {
        statusCode: 502,
        code: -32005,
        retryable: true,
      });
    }
    if (!response.ok) {
      throw new RpcRouterError(`Provider HTTP ${response.status}`, {
        statusCode: 502,
        code: -32000,
      });
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      throwIfRetryableJsonRpcError(parsed);
      return parsed;
    } catch (error) {
      if (error instanceof RpcRouterError) {
        throw error;
      }
      throw new RpcRouterError("Provider returned malformed JSON", {
        statusCode: 502,
        code: -32700,
        retryable: true,
      });
    }
  } catch (error) {
    if (error instanceof RpcRouterError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new RpcRouterError(`Provider request timed out after ${timeoutMs}ms`, {
        statusCode: 504,
        code: -32000,
        retryable: true,
      });
    }
    throw new RpcRouterError(error instanceof Error ? error.message : String(error), {
      statusCode: 502,
      code: -32000,
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function rpcErrorResponseFromError(error: unknown, id?: string | number | null): Record<string, unknown> {
  if (error instanceof RpcGuardError) {
    return makeJsonRpcError(id, {
      code: error.code,
      message: error.message,
      data: error.data,
    });
  }
  if (error instanceof RpcRouterError) {
    return makeJsonRpcError(id, {
      code: error.code,
      message: error.message,
      data: error.data,
    });
  }
  return makeJsonRpcError(id, {
    code: -32000,
    message: error instanceof Error ? error.message : String(error),
  });
}

export function statusCodeFromError(error: unknown): number {
  if (error instanceof RpcGuardError) {
    return error.statusCode;
  }
  if (error instanceof RpcRouterError) {
    return error.statusCode;
  }
  return 500;
}

function isRetryableTransportError(error: unknown): boolean {
  return error instanceof RpcRouterError ? error.retryable : true;
}

function readInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

async function assertPublicRpcTarget(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new RpcRouterError("Provider URL is invalid", { statusCode: 502, code: -32000 });
  }

  if (parsed.protocol !== "https:") {
    throw new RpcRouterError("Provider URL must use https", { statusCode: 502, code: -32000 });
  }
  if (parsed.port && parsed.port !== "443") {
    throw new RpcRouterError("Provider URL uses a disallowed port", { statusCode: 502, code: -32000 });
  }
  if (isPrivateOrInternalHost(parsed.hostname)) {
    throw new RpcRouterError("Provider host is private or internal", { statusCode: 502, code: -32000 });
  }

  const ipVersion = net.isIP(parsed.hostname);
  if (ipVersion !== 0) {
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new RpcRouterError(error instanceof Error ? error.message : String(error), {
      statusCode: 502,
      code: -32000,
      retryable: true,
    });
  }

  if (addresses.length === 0 || addresses.some((entry) => isPrivateOrInternalHost(entry.address))) {
    throw new RpcRouterError("Provider DNS resolves to a private or internal address", {
      statusCode: 502,
      code: -32000,
    });
  }
}

function throwIfRetryableJsonRpcError(response: unknown): void {
  const errors = (Array.isArray(response) ? response : [response])
    .map((item) => (isRecord(item) && isRecord(item.error) ? item.error : undefined))
    .filter((error): error is Record<string, unknown> => Boolean(error));

  const retryable = errors.find(isRetryableJsonRpcProviderError);
  if (!retryable) {
    return;
  }

  const code = typeof retryable.code === "number" ? retryable.code : -32000;
  const message = typeof retryable.message === "string" ? retryable.message : "Provider JSON-RPC error";
  throw new RpcRouterError(`Provider JSON-RPC error: ${message}`, {
    statusCode: 502,
    code,
    retryable: true,
  });
}

function isRetryableJsonRpcProviderError(error: Record<string, unknown>): boolean {
  const code = typeof error.code === "number" ? error.code : undefined;
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (code === -32005 || code === -32002 || code === -32001) {
    return true;
  }
  return /rate|limit|too many|timeout|temporar|backend|busy|unavailable|exceed/u.test(message);
}

async function mapWithConcurrency<T>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await fn(current);
    }
  });
  await Promise.all(workers);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseHexBlockNumber(value: string | undefined): bigint | undefined {
  if (!value || !/^0x[0-9a-f]+$/iu.test(value)) {
    return undefined;
  }
  return BigInt(value);
}

function redactSecretsInText(text: string): string {
  return text.replace(/https?:\/\/[^\s"')]+/gu, (match) => redactUrl(match));
}

function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? "***" : "";
      parsed.password = parsed.password ? "***" : "";
    }
    if (parsed.search) {
      parsed.search = "?redacted";
    }
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      parsed.pathname = "/***";
    }
    return parsed.toString();
  } catch {
    return "<invalid-url>";
  }
}
