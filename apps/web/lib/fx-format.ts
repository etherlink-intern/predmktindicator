/* Pure formatting functions and types — safe to import in client components */

export function formatAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatDate(value: string | null) {
  if (!value) return "No snapshot yet";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatUsd(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits
  }).format(value);
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

export function displayInstrument(collateral: string) {
  return collateral.toLowerCase().includes("btc") ? "BTC" : "ETH";
}

export function displayPool(poolName: string) {
  const instrument = poolName.toLowerCase().includes("btc") ? "BTC" : "ETH";
  const side = poolName.toLowerCase().includes("short") ? "Short" : "Long";
  return `${instrument} ${side}`;
}

export type TopTrader = {
  address: string;
  totalPnlUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  notionalUsd: number;
  capitalUsedUsd: number;
  roi: number;
  openPositions: number;
  closedPositions: number;
  totalPositions: number;
  winRate: number;
  maxDebtRatio: number;
  equityUsd: number;
  feesUsd: number;
};
