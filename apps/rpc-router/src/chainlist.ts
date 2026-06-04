import net from "node:net";

export type TrackingPreference = "none" | "limited" | "unspecified" | "yes";

export type ProviderCandidate = {
  url: string;
  normalizedUrl: string;
  source: "manual" | "chainlist" | "chainid";
  tracking: TrackingPreference;
};

export type FetchLike = typeof fetch;

export type DynamicEndpointOptions = {
  chainlistUrl: string;
  chainidUrl: string;
  ttlMs: number;
  fetchFn?: FetchLike;
  now?: () => number;
};

type CacheEntry = {
  expiresAt: number;
  candidates: ProviderCandidate[];
};

let dynamicCache: CacheEntry | undefined;

const PLACEHOLDER_RE = /(?:\$\{[^}]+\}|%7B|%7D|<[^>]+>|YOUR[_-]?|API[_-]?KEY|PROJECT[_-]?ID|INFURA[_-]?KEY|ALCHEMY[_-]?KEY|TOKEN_HERE|INSERT[_-]?)/i;

const TRACKING_PRIORITY: Record<TrackingPreference, number> = {
  none: 0,
  limited: 1,
  unspecified: 2,
  yes: 3,
};

export function clearDynamicEndpointCache(): void {
  dynamicCache = undefined;
}

export function trackingPriority(tracking: TrackingPreference): number {
  return TRACKING_PRIORITY[tracking] ?? TRACKING_PRIORITY.unspecified;
}

export function normalizeProviderUrl(rawUrl: string): string | undefined {
  const trimmed = rawUrl.trim();
  if (!trimmed || PLACEHOLDER_RE.test(trimmed)) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "https:") {
    return undefined;
  }

  parsed.protocol = "https:";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.port === "443") {
    parsed.port = "";
  }
  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  }
  parsed.hash = "";

  return parsed.toString();
}

export function isPrivateOrInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (
    host === "localhost" ||
    host === "0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan")
  ) {
    return true;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const octets = host.split(".").map((part) => Number(part));
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  if (ipVersion === 6) {
    return (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80")
    );
  }

  return false;
}

export function candidateFromUrl(
  rawUrl: string,
  source: ProviderCandidate["source"],
  tracking: TrackingPreference = "unspecified",
  rejectPrivate = true,
): ProviderCandidate | undefined {
  const normalizedUrl = normalizeProviderUrl(rawUrl);
  if (!normalizedUrl) {
    return undefined;
  }

  const parsed = new URL(normalizedUrl);
  if (rejectPrivate && isPrivateOrInternalHost(parsed.hostname)) {
    return undefined;
  }

  return {
    url: normalizedUrl,
    normalizedUrl,
    source,
    tracking,
  };
}

export function parseManualEndpoints(env: NodeJS.ProcessEnv): ProviderCandidate[] {
  const values = [
    env.ETHEREUM_RPC_URL,
    env.ETHEREUM_RPC_FALLBACK_URLS,
    env.CHAINLIST_ETHEREUM_RPC_URLS,
    env.GOLDSKY_RPC_URL,
    env.CHAINSTACK_RPC_URL,
    env.ALCHEMY_RPC_URL,
  ];

  return dedupeAndSortCandidates(
    values
      .flatMap((value) => splitEndpointList(value))
      .map((url) => candidateFromUrl(url, "manual", "none", false))
      .filter((candidate): candidate is ProviderCandidate => Boolean(candidate)),
  );
}

export function splitEndpointList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[\n,\s]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function loadDynamicEndpointCandidates(
  options: DynamicEndpointOptions,
  force = false,
): Promise<ProviderCandidate[]> {
  const now = options.now?.() ?? Date.now();
  if (!force && dynamicCache && dynamicCache.expiresAt > now) {
    return dynamicCache.candidates;
  }

  const fetchFn = options.fetchFn ?? fetch;
  const candidates: ProviderCandidate[] = [];

  const [chainlist, chainid] = await Promise.allSettled([
    fetchJson(fetchFn, options.chainlistUrl),
    fetchJson(fetchFn, options.chainidUrl),
  ]);

  if (chainlist.status === "fulfilled") {
    candidates.push(...parseChainListRpcs(chainlist.value));
  }

  if (chainid.status === "fulfilled") {
    candidates.push(...parseChainIdRpcs(chainid.value));
  }

  const sorted = dedupeAndSortCandidates(candidates);
  dynamicCache = {
    candidates: sorted,
    expiresAt: now + options.ttlMs,
  };
  return sorted;
}

async function fetchJson(fetchFn: FetchLike, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchFn(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`fetch ${url} failed with HTTP ${response.status}`);
    }
    const text = await response.text();
    if (text.length > 2_000_000) {
      throw new Error(`fetch ${url} exceeded maximum response size`);
    }
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseChainListRpcs(payload: unknown): ProviderCandidate[] {
  const candidates: ProviderCandidate[] = [];
  const chains = Array.isArray(payload) ? payload : [];

  for (const chain of chains) {
    if (!isRecord(chain)) {
      continue;
    }
    const chainId = Number(chain.chainId ?? chain.chain_id ?? chain.id);
    if (chainId !== 1) {
      continue;
    }

    const rpcEntries = extractRpcEntries(chain.rpc ?? chain.rpcs ?? chain.rpcUrls);
    for (const entry of rpcEntries) {
      const { url, tracking } = parseRpcEntry(entry);
      if (!url) {
        continue;
      }
      const candidate = candidateFromUrl(url, "chainlist", tracking, true);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return dedupeAndSortCandidates(candidates);
}

export function parseChainIdRpcs(payload: unknown): ProviderCandidate[] {
  if (!isRecord(payload)) {
    return [];
  }

  const chainId = Number(payload.chainId ?? payload.chain_id ?? payload.id);
  if (chainId && chainId !== 1) {
    return [];
  }

  return dedupeAndSortCandidates(
    extractRpcEntries(payload.rpc ?? payload.rpcs ?? payload.rpcUrls)
      .map((entry) => parseRpcEntry(entry))
      .map(({ url }) => (url ? candidateFromUrl(url, "chainid", "unspecified", true) : undefined))
      .filter((candidate): candidate is ProviderCandidate => Boolean(candidate)),
  );
}

export function dedupeAndSortCandidates(candidates: ProviderCandidate[]): ProviderCandidate[] {
  const seen = new Map<string, ProviderCandidate>();
  for (const candidate of candidates) {
    const existing = seen.get(candidate.normalizedUrl);
    if (!existing || trackingPriority(candidate.tracking) < trackingPriority(existing.tracking)) {
      seen.set(candidate.normalizedUrl, candidate);
    }
  }

  return [...seen.values()].sort((a, b) => {
    const trackingDelta = trackingPriority(a.tracking) - trackingPriority(b.tracking);
    if (trackingDelta !== 0) {
      return trackingDelta;
    }
    const sourceDelta = sourcePriority(a.source) - sourcePriority(b.source);
    if (sourceDelta !== 0) {
      return sourceDelta;
    }
    return a.normalizedUrl.localeCompare(b.normalizedUrl);
  });
}

function sourcePriority(source: ProviderCandidate["source"]): number {
  if (source === "manual") {
    return 0;
  }
  if (source === "chainlist") {
    return 1;
  }
  return 2;
}

function extractRpcEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (isRecord(value)) {
    const nested = value.default ?? value.http ?? value.urls;
    if (Array.isArray(nested)) {
      return nested;
    }
  }
  return [];
}

function parseRpcEntry(entry: unknown): { url?: string; tracking: TrackingPreference } {
  if (typeof entry === "string") {
    return { url: entry, tracking: "unspecified" };
  }
  if (!isRecord(entry)) {
    return { tracking: "unspecified" };
  }

  const rawTracking = String(entry.tracking ?? entry.privacy ?? "unspecified").toLowerCase();
  const tracking: TrackingPreference =
    rawTracking === "none" || rawTracking === "limited" || rawTracking === "yes"
      ? rawTracking
      : "unspecified";

  const url = typeof entry.url === "string" ? entry.url : typeof entry.rpc === "string" ? entry.rpc : undefined;
  return { url, tracking };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
