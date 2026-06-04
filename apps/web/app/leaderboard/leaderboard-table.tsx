"use client";

import { useMemo, useState } from "react";
import type { TraderSummary } from "../../lib/fx-dashboard";

type SortKey =
  | "notionalValueUsd"
  | "equityUsd"
  | "debtValueUsd"
  | "maxDebtRatio"
  | "ethNetExposureUsd"
  | "btcNetExposureUsd"
  | "unrealizedPnlUsd";

type SortDirection = "asc" | "desc";

type LeaderboardTableProps = {
  traders: TraderSummary[];
};

const columns: Array<{ key: SortKey; label: string; align?: "right" }> = [
  { key: "notionalValueUsd", label: "Notional", align: "right" },
  { key: "equityUsd", label: "Equity", align: "right" },
  { key: "unrealizedPnlUsd", label: "Unrlzd PnL", align: "right" },
  { key: "debtValueUsd", label: "Debt", align: "right" },
  { key: "maxDebtRatio", label: "Debt ratio", align: "right" },
  { key: "ethNetExposureUsd", label: "Net ETH", align: "right" },
  { key: "btcNetExposureUsd", label: "Net BTC", align: "right" }
];

function formatAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function formatCompactUsd(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (absolute >= 1_000) return `${sign}$${Math.round(absolute / 1_000).toLocaleString()}K`;
  return `${sign}$${Math.round(absolute).toLocaleString()}`;
}

function formatPnl(value: number, hasHistory: boolean) {
  return hasHistory ? formatCompactUsd(value) : "—";
}

function getFeesUsd(trader: TraderSummary) {
  return "feesUsd" in trader && typeof trader.feesUsd === "number" ? trader.feesUsd : 0;
}

function formatPositionBadge(count: number) {
  return `${count.toLocaleString()}×`;
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

function parseNumber(value: string) {
  if (!value.trim()) return 0;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function riskTone(debtRatio: number) {
  const clamped = Math.max(0, Math.min(debtRatio, 1));
  if (clamped >= 0.9) return "risk-badge critical";
  if (clamped >= 0.8) return "risk-badge high";
  if (clamped >= 0.65) return "risk-badge elevated";
  return "risk-badge normal";
}

function instrumentBreakdown(trader: TraderSummary): Array<{ asset: string; side: string; count: number; pillClass: string }> {
  return [
    { asset: "ETH", side: "Long", count: trader.wstethLong, pillClass: "pill-split pill-eth-long" },
    { asset: "ETH", side: "Short", count: trader.wstethShort, pillClass: "pill-split pill-eth-short" },
    { asset: "BTC", side: "Long", count: trader.wbtcLong, pillClass: "pill-split pill-btc-long" },
    { asset: "BTC", side: "Short", count: trader.wbtcShort, pillClass: "pill-split pill-btc-short" }
  ].filter((item) => item.count > 0);
}

function netExposureTone(value: number) {
  if (Math.abs(value) < 1) return "net-badge flat";
  return value > 0 ? "net-badge long" : "net-badge short";
}

function netExposureLabel(value: number) {
  if (Math.abs(value) < 1) return "Flat";
  return value > 0 ? "Net long" : "Net short";
}

function NetExposureCell({ longUsd, netUsd, shortUsd }: { longUsd: number; netUsd: number; shortUsd: number }) {
  return (
    <span className={netExposureTone(netUsd)} title={`Long ${formatUsd(longUsd)} / Short ${formatUsd(shortUsd)}`}>
      {netExposureLabel(netUsd).replace("Net ", "")}&nbsp;{formatCompactUsd(Math.abs(netUsd))}
    </span>
  );
}

export function LeaderboardTable({ traders }: LeaderboardTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("notionalValueUsd");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [minPositions, setMinPositions] = useState("1");
  const [minNotional, setMinNotional] = useState("100");
  const [walletSearch, setWalletSearch] = useState("");

  const filtered = useMemo(() => {
    const positionFloor = parseNumber(minPositions);
    const notionalFloor = parseNumber(minNotional);
    const search = walletSearch.toLowerCase().trim();

    return [...traders]
      .filter((trader) => {
        if (trader.positions < positionFloor) return false;
        if (trader.notionalValueUsd < notionalFloor) return false;
        if (search && !trader.owner.toLowerCase().includes(search)) return false;
        return true;
      })
      .sort((a, b) => {
        const first = a[sortKey];
        const second = b[sortKey];
        const delta = first === second ? a.owner.localeCompare(b.owner) : first - second;
        return sortDirection === "asc" ? delta : -delta;
      });
  }, [traders, minPositions, minNotional, sortDirection, sortKey, walletSearch]);

  function updateSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("desc");
  }

  return (
    <>
      <div className="filter-bar" aria-label="Leaderboard filters">
        <label>
          <span>Minimum open positions</span>
          <input
            inputMode="numeric"
            min="0"
            type="number"
            value={minPositions}
            onChange={(event) => setMinPositions(event.target.value)}
          />
        </label>
        <label>
          <span>Minimum notional value</span>
          <input
            inputMode="numeric"
            min="0"
            placeholder="Any"
            type="number"
            value={minNotional}
            onChange={(event) => setMinNotional(event.target.value)}
          />
        </label>
        <label>
          <span>Wallet search</span>
          <input
            placeholder="0x..."
            type="text"
            value={walletSearch}
            onChange={(event) => setWalletSearch(event.target.value)}
          />
        </label>
        <p className="muted small">
          Showing {filtered.length.toLocaleString()} of {traders.length.toLocaleString()} wallets. Click any column
          header to sort. Net ETH/BTC compares each wallet's open long exposure against open short borrowed exposure.
        </p>
      </div>

      <div className="table-wrap">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th className="rank-cell">Rank</th>
              <th>Wallet</th>
              {columns.map((column) => (
                <th className={column.align === "right" ? "numeric" : undefined} key={column.key}>
                  <button
                    type="button"
                    className="sort-button"
                    onClick={() => updateSort(column.key)}
                    aria-label={`Sort by ${column.label}`}
                  >
                    {column.label}
                    <span aria-hidden="true">{sortKey === column.key ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((trader, index) => {
              const headroom = Math.max(0, 1 - trader.maxDebtRatio);
              const instruments = instrumentBreakdown(trader)
                .map((item) => `${item.asset} ${item.side}: ${item.count}`)
                .join(" / ");
              const rowTitle = [
                `${trader.owner}`,
                `${trader.positions.toLocaleString()} open positions across ${trader.pools.toLocaleString()} markets`,
                `Notional ${formatUsd(trader.notionalValueUsd)}`,
                `Equity ${formatUsd(trader.equityUsd)}`,
                `Unrealized PnL ${trader.hasPositionHistory ? formatUsd(trader.unrealizedPnlUsd) : "not available"}`,
                `Fees paid ${formatUsd(getFeesUsd(trader))}`,
                instruments ? `Instruments: ${instruments}` : null
              ].filter(Boolean).join("\n");
              return (
                <tr key={trader.owner} title={rowTitle}>
                  <td className="rank-cell">#{index + 1}</td>
                  <td className="wallet-cell">
                    <a className="wallet-link mono" href={`/traders/${trader.owner}`} title={trader.owner}>
                      <span>{formatAddress(trader.owner)}</span>
                      <span className="position-badge" title={`${trader.positions.toLocaleString()} open positions`}>
                        {formatPositionBadge(trader.positions)}
                      </span>
                    </a>
                  </td>
                  <td className="numeric" title={formatUsd(trader.notionalValueUsd)}>{formatCompactUsd(trader.notionalValueUsd)}</td>
                  <td className="numeric" title={formatUsd(trader.equityUsd)}>{formatCompactUsd(trader.equityUsd)}</td>
                  <td className="numeric" title={trader.hasPositionHistory ? formatUsd(trader.unrealizedPnlUsd) : "PnL history unavailable"}>
                    {formatPnl(trader.unrealizedPnlUsd, trader.hasPositionHistory)}
                  </td>
                  <td className="numeric" title={formatUsd(trader.debtValueUsd)}>{formatCompactUsd(trader.debtValueUsd)}</td>
                  <td className="numeric">
                    <span className={riskTone(trader.maxDebtRatio)} title={`${formatPercent(trader.maxDebtRatio)} debt ratio / ${formatPercent(headroom)} to 100%`}>
                      {formatPercent(trader.maxDebtRatio)}
                    </span>
                  </td>
                  <td className="numeric">
                    <NetExposureCell
                      longUsd={trader.ethLongExposureUsd}
                      netUsd={trader.ethNetExposureUsd}
                      shortUsd={trader.ethShortExposureUsd}
                    />
                  </td>
                  <td className="numeric">
                    <NetExposureCell
                      longUsd={trader.btcLongExposureUsd}
                      netUsd={trader.btcNetExposureUsd}
                      shortUsd={trader.btcShortExposureUsd}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
