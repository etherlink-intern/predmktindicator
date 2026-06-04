"use client";

import { useMemo, useState } from "react";
import type { TraderSummary } from "../../lib/fx-dashboard";

type SortKey =
  | "notionalValueUsd"
  | "positions"
  | "equityUsd"
  | "debtValueUsd"
  | "maxDebtRatio"
  | "ethNetExposureUsd"
  | "btcNetExposureUsd"
  | "pools"
  | "unrealizedPnlUsd"
  | "totalPnlUsd"
  | "feesUsd";

type SortDirection = "asc" | "desc";

type LeaderboardTableProps = {
  traders: TraderSummary[];
};

const columns: Array<{ key: SortKey; label: string; align?: "right" }> = [
  { key: "notionalValueUsd", label: "Notional value", align: "right" },
  { key: "positions", label: "Open positions", align: "right" },
  { key: "equityUsd", label: "Current equity", align: "right" },
  { key: "unrealizedPnlUsd", label: "Unrealized PnL", align: "right" },
  { key: "totalPnlUsd", label: "Total PnL", align: "right" },
  { key: "feesUsd", label: "Fees paid", align: "right" },
  { key: "debtValueUsd", label: "Debt value", align: "right" },
  { key: "maxDebtRatio", label: "Max debt ratio", align: "right" },
  { key: "ethNetExposureUsd", label: "Net ETH", align: "right" },
  { key: "btcNetExposureUsd", label: "Net BTC", align: "right" },
  { key: "pools", label: "Markets", align: "right" }
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
  if (clamped >= 0.9) return "risk-cell critical";
  if (clamped >= 0.8) return "risk-cell high";
  if (clamped >= 0.65) return "risk-cell elevated";
  return "risk-cell normal";
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
  if (Math.abs(value) < 1) return "net-exposure flat";
  return value > 0 ? "net-exposure long" : "net-exposure short";
}

function netExposureLabel(value: number) {
  if (Math.abs(value) < 1) return "Flat";
  return value > 0 ? "Net long" : "Net short";
}

function NetExposureCell({ longUsd, netUsd, shortUsd }: { longUsd: number; netUsd: number; shortUsd: number }) {
  return (
    <span className={netExposureTone(netUsd)} title={`Long ${formatUsd(longUsd)} / Short ${formatUsd(shortUsd)}`}>
      <strong>{netExposureLabel(netUsd)}</strong>
      <small>{formatUsd(Math.abs(netUsd))}</small>
    </span>
  );
}

export function LeaderboardTable({ traders }: LeaderboardTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("notionalValueUsd");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [minPositions, setMinPositions] = useState("1");
  const [minNotional, setMinNotional] = useState("100");

  const filtered = useMemo(() => {
    const positionFloor = parseNumber(minPositions);
    const notionalFloor = parseNumber(minNotional);

    return [...traders]
      .filter((trader) => trader.positions >= positionFloor && trader.notionalValueUsd >= notionalFloor)
      .sort((a, b) => {
        const first = a[sortKey];
        const second = b[sortKey];
        const delta = first === second ? a.owner.localeCompare(b.owner) : first - second;
        return sortDirection === "asc" ? delta : -delta;
      });
  }, [traders, minPositions, minNotional, sortDirection, sortKey]);

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
      <div className="filter-card" aria-label="Leaderboard filters">
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
        <p className="muted small">
          Showing {filtered.length.toLocaleString()} of {traders.length.toLocaleString()} wallets. Click any column
          header to sort. Net ETH/BTC compares each wallet's open long exposure against open short borrowed exposure.
        </p>
      </div>

      <div className="table-card">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>Rank</th>
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
              <th>Instruments</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((trader, index) => {
              const headroom = Math.max(0, 1 - trader.maxDebtRatio);
              return (
                <tr key={trader.owner}>
                  <td>#{index + 1}</td>
                  <td>
                    <a className="mono" href={`/traders/${trader.owner}`} title={trader.owner}>
                      {formatAddress(trader.owner)}
                    </a>
                  </td>
                  <td className="numeric">{formatUsd(trader.notionalValueUsd)}</td>
                  <td className="numeric">{trader.positions.toLocaleString()}</td>
                  <td className="numeric">{formatUsd(trader.equityUsd)}</td>
                  <td className="numeric">{trader.hasPositionHistory ? formatUsd(trader.unrealizedPnlUsd) : "—"}</td>
                  <td className="numeric">{trader.hasPositionHistory ? formatUsd(trader.totalPnlUsd) : "—"}</td>
                  <td className="numeric">{formatUsd(trader.feesUsd)}</td>
                  <td className="numeric">{formatUsd(trader.debtValueUsd)}</td>
                  <td className="numeric">
                    <span className={riskTone(trader.maxDebtRatio)}>
                      <strong>{formatPercent(trader.maxDebtRatio)}</strong>
                      <small>{formatPercent(headroom)} to 100%</small>
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
                  <td className="numeric">{trader.pools.toLocaleString()}</td>
                  <td className="instrument-list">
                    {instrumentBreakdown(trader).map((item) => (
                      <span className={item.pillClass} key={`${item.asset}-${item.side}`}>
                        <span className="pill-asset">{item.asset}</span>
                        <span className="pill-side">{item.side} {item.count.toLocaleString()}</span>
                      </span>
                    ))}
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
