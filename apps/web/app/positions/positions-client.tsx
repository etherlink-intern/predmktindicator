"use client";

import { useMemo, useState } from "react";
import type { PositionSummary } from "../../lib/fx-dashboard";
import { displayInstrument, displayPool, formatAddress, formatPercent, formatUsd } from "../../lib/fx-format";

type SortKey = "position" | "wallet" | "market" | "side" | "size" | "entry" | "pnl" | "roi" | "collateral" | "debt" | "equity" | "debtRatio";
type SortDirection = "asc" | "desc";
type ColumnFilterKey = "all" | SortKey;

type NumericFilter =
  | { kind: "none" }
  | { kind: "gte" | "gt" | "lte" | "lt"; value: number }
  | { kind: "range"; min: number; max: number };

const COLUMN_FILTERS: { value: ColumnFilterKey; label: string }[] = [
  { value: "all", label: "All columns" },
  { value: "position", label: "Position NFT" },
  { value: "wallet", label: "Wallet" },
  { value: "market", label: "Market" },
  { value: "side", label: "Side" },
  { value: "size", label: "Position size" },
  { value: "entry", label: "Entry" },
  { value: "pnl", label: "PnL" },
  { value: "roi", label: "ROI" },
  { value: "collateral", label: "Collateral" },
  { value: "debt", label: "Debt" },
  { value: "equity", label: "Equity" },
  { value: "debtRatio", label: "Debt ratio" },
];

function positionSizeUsd(position: PositionSummary) {
  return position.side === "long" ? position.collateralValueUsd : position.debtValueUsd;
}

function positionRoi(position: PositionSummary) {
  // Current NFT ROI: unrealized PnL divided by current equity/capital in that position NFT.
  return position.equityUsd > 0 ? position.unrealizedPnlUsd / position.equityUsd : 0;
}

function getSortValue(position: PositionSummary, key: SortKey): number | string {
  switch (key) {
    case "position": return Number(position.tokenId);
    case "wallet": return position.owner;
    case "market": return displayPool(position.poolName);
    case "side": return position.side;
    case "size": return positionSizeUsd(position);
    case "entry": return position.entryPriceUsd;
    case "pnl": return position.unrealizedPnlUsd;
    case "roi": return positionRoi(position);
    case "collateral": return position.collateralValueUsd;
    case "debt": return position.debtValueUsd;
    case "equity": return position.equityUsd;
    case "debtRatio": return position.debtRatio;
  }
}

function getColumnText(position: PositionSummary, key: ColumnFilterKey) {
  const market = displayPool(position.poolName);
  const asset = displayInstrument(position.collateral);
  const values: Record<ColumnFilterKey, string> = {
    all: [
      position.tokenId,
      position.owner,
      formatAddress(position.owner),
      market,
      asset,
      position.side,
      formatUsd(positionSizeUsd(position)),
      formatUsd(position.entryPriceUsd),
      formatUsd(position.unrealizedPnlUsd),
      formatPercent(positionRoi(position)),
      formatUsd(position.collateralValueUsd),
      formatUsd(position.debtValueUsd),
      formatUsd(position.equityUsd),
      formatPercent(position.debtRatio),
    ].join(" "),
    position: position.tokenId,
    wallet: `${position.owner} ${formatAddress(position.owner)}`,
    market: `${market} ${asset}`,
    side: position.side,
    size: formatUsd(positionSizeUsd(position)),
    entry: formatUsd(position.entryPriceUsd),
    pnl: formatUsd(position.unrealizedPnlUsd),
    roi: formatPercent(positionRoi(position)),
    collateral: formatUsd(position.collateralValueUsd),
    debt: formatUsd(position.debtValueUsd),
    equity: formatUsd(position.equityUsd),
    debtRatio: formatPercent(position.debtRatio),
  };
  return values[key].toLowerCase();
}

function parseNumericFilter(raw: string, percentMode: boolean): NumericFilter {
  const query = raw.trim().replace(/,/g, "");
  if (!query) return { kind: "none" };

  const normalize = (value: string) => {
    const hasPercent = value.includes("%");
    const parsed = Number(value.replace(/[$%x×]/gi, ""));
    if (!Number.isFinite(parsed)) return null;
    if (percentMode && (hasPercent || Math.abs(parsed) > 1)) return parsed / 100;
    return parsed;
  };

  const rangeMatch = query.match(/^(-?\d+(?:\.\d+)?%?)\s*(?:\.\.|-)\s*(-?\d+(?:\.\d+)?%?)$/);
  if (rangeMatch) {
    const min = normalize(rangeMatch[1]);
    const max = normalize(rangeMatch[2]);
    if (min !== null && max !== null) return { kind: "range", min: Math.min(min, max), max: Math.max(min, max) };
  }

  const opMatch = query.match(/^(>=|<=|>|<)\s*(-?\$?\d+(?:\.\d+)?%?)$/);
  if (opMatch) {
    const value = normalize(opMatch[2]);
    if (value !== null) {
      const kind = opMatch[1] === ">=" ? "gte" : opMatch[1] === "<=" ? "lte" : opMatch[1] === ">" ? "gt" : "lt";
      return { kind, value };
    }
  }

  const plain = normalize(query);
  if (plain !== null) return { kind: "gte", value: plain };
  return { kind: "none" };
}

function matchesNumericFilter(value: number, filter: NumericFilter) {
  switch (filter.kind) {
    case "none": return true;
    case "gte": return value >= filter.value;
    case "gt": return value > filter.value;
    case "lte": return value <= filter.value;
    case "lt": return value < filter.value;
    case "range": return value >= filter.min && value <= filter.max;
  }
}

function matchesColumnFilter(position: PositionSummary, key: ColumnFilterKey, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  if (key === "all" || key === "position" || key === "wallet" || key === "market" || key === "side") {
    return getColumnText(position, key).includes(query);
  }

  const value = Number(getSortValue(position, key));
  const filter = parseNumericFilter(query, key === "roi" || key === "debtRatio");
  if (filter.kind !== "none") return matchesNumericFilter(value, filter);
  return getColumnText(position, key).includes(query);
}

function riskClass(debtRatio: number) {
  if (debtRatio >= 0.9) return "critical";
  if (debtRatio >= 0.8) return "high";
  if (debtRatio >= 0.65) return "elevated";
  return "normal";
}

function SortHeader({
  label,
  keyName,
  activeKey,
  direction,
  className,
  onSort,
}: {
  label: string;
  keyName: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  className?: string;
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === keyName;
  return (
    <th className={className}>
      <button type="button" className="sort-button" onClick={() => onSort(keyName)} title={`Sort by ${label}`}>
        {label}<span aria-hidden="true">{active ? (direction === "asc" ? " ↑" : " ↓") : ""}</span>
      </button>
    </th>
  );
}

export function PositionsClient({ positions }: { positions: PositionSummary[] }) {
  const [assetFilter, setAssetFilter] = useState("all");
  const [sideFilter, setSideFilter] = useState("all");
  const [columnFilter, setColumnFilter] = useState<ColumnFilterKey>("all");
  const [columnQuery, setColumnQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("size");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const assets = useMemo(() => Array.from(new Set(positions.map((p) => displayInstrument(p.collateral)))).sort(), [positions]);

  const filtered = useMemo(() => {
    const rows = positions.filter((position) => {
      const asset = displayInstrument(position.collateral);
      if (assetFilter !== "all" && asset !== assetFilter) return false;
      if (sideFilter !== "all" && position.side !== sideFilter) return false;
      return matchesColumnFilter(position, columnFilter, columnQuery);
    });

    return rows.sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      let delta = 0;
      if (typeof av === "string" || typeof bv === "string") {
        delta = String(av).localeCompare(String(bv));
      } else {
        delta = av === bv ? 0 : av - bv;
      }
      if (delta === 0) delta = Number(a.tokenId) - Number(b.tokenId);
      return sortDirection === "asc" ? delta : -delta;
    });
  }, [assetFilter, columnFilter, columnQuery, positions, sideFilter, sortDirection, sortKey]);

  const summary = useMemo(() => {
    return filtered.reduce(
      (acc, position) => {
        acc.size += positionSizeUsd(position);
        acc.pnl += position.unrealizedPnlUsd;
        acc.equity += position.equityUsd;
        return acc;
      },
      { size: 0, pnl: 0, equity: 0 },
    );
  }, [filtered]);

  function updateSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "wallet" || nextKey === "market" || nextKey === "side" ? "asc" : "desc");
  }

  function resetFilters() {
    setAssetFilter("all");
    setSideFilter("all");
    setColumnFilter("all");
    setColumnQuery("");
    setSortKey("size");
    setSortDirection("desc");
  }

  return (
    <section>
      <p className="eyebrow">Positions</p>
      <h1>Open position book</h1>
      <p className="muted">
        Open f(x) position NFTs ranked by current position size. Position size is collateral value for longs and borrowed exposure for shorts. ROI is unrealized PnL divided by current equity in the NFT position.
      </p>

      <div className="filter-bar" aria-label="Open position filters">
        <label>
          <span>Currency</span>
          <select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}>
            <option value="all">All currencies</option>
            {assets.map((asset) => <option key={asset} value={asset}>{asset}</option>)}
          </select>
        </label>
        <label>
          <span>Side</span>
          <select value={sideFilter} onChange={(event) => setSideFilter(event.target.value)}>
            <option value="all">Long + short</option>
            <option value="long">Longs</option>
            <option value="short">Shorts</option>
          </select>
        </label>
        <label>
          <span>Column filter</span>
          <select value={columnFilter} onChange={(event) => setColumnFilter(event.target.value as ColumnFilterKey)}>
            {COLUMN_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
          </select>
        </label>
        <label>
          <span>Filter value</span>
          <input
            type="text"
            value={columnQuery}
            onChange={(event) => setColumnQuery(event.target.value)}
            placeholder={columnFilter === "roi" || columnFilter === "debtRatio" ? ">20%, <75%, 10-30%" : "0x..., ETH, >100000"}
          />
        </label>
        <div>
          <span className="muted small" style={{ display: "block", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Results</span>
          <p className="muted small">
            Showing {filtered.length.toLocaleString()} / {positions.length.toLocaleString()} NFTs · Size {formatUsd(summary.size)} · PnL <span className={summary.pnl >= 0 ? "positive" : "negative"}>{formatUsd(summary.pnl)}</span> · Book ROI {summary.equity > 0 ? formatPercent(summary.pnl / summary.equity) : "—"}
          </p>
          <button type="button" className="button ghost" onClick={resetFilters}>Reset filters</button>
        </div>
      </div>

      <p className="muted small" style={{ marginTop: 10 }}>
        Column filters support text search plus numeric filters such as <code>&gt;20%</code>, <code>&lt;75%</code>, or <code>10-30%</code>. Click any header to sort the filtered result set.
      </p>

      {filtered.length === 0 ? (
        <div className="card-warning">
          <p className="muted">No open position NFTs match the current filters.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="compact" style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                <SortHeader label="Position" keyName="position" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
                <SortHeader label="Wallet" keyName="wallet" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
                <SortHeader label="Market" keyName="market" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
                <SortHeader label="Side" keyName="side" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
                <SortHeader label="Size" keyName="size" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" />
                <SortHeader label="Entry" keyName="entry" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" />
                <SortHeader label="PnL" keyName="pnl" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" />
                <SortHeader label="ROI" keyName="roi" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" />
                <SortHeader label="Collateral" keyName="collateral" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" />
                <SortHeader label="Debt" keyName="debt" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" />
                <SortHeader label="Equity" keyName="equity" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" />
                <SortHeader label="Debt ratio" keyName="debtRatio" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((position) => {
                const roi = positionRoi(position);
                const size = positionSizeUsd(position);
                return (
                  <tr
                    key={`${position.poolAddress}-${position.tokenId}`}
                    title={`Position NFT #${position.tokenId}\nWallet: ${position.owner}\nMarket: ${displayPool(position.poolName)}\nPosition size: ${formatUsd(size)}\nROI: ${formatPercent(roi)}\nDebt ratio: ${formatPercent(position.debtRatio)}`}
                  >
                    <td><a className="mono" href={`/positions/${position.poolAddress}-${position.tokenId}`}>#{position.tokenId}</a></td>
                    <td><a className="mono" href={`/traders/${position.owner}`}>{formatAddress(position.owner)}</a></td>
                    <td>{displayPool(position.poolName)}</td>
                    <td><span className={`pill ${position.side}`}>{position.side}</span></td>
                    <td className="numeric mono">{formatUsd(size)}</td>
                    <td className="numeric mono">{position.entryPriceUsd ? formatUsd(position.entryPriceUsd) : "—"}</td>
                    <td className={`numeric mono ${position.unrealizedPnlUsd > 0 ? "positive" : position.unrealizedPnlUsd < 0 ? "negative" : ""}`}>{formatUsd(position.unrealizedPnlUsd)}</td>
                    <td className={`numeric mono ${roi > 0 ? "positive" : roi < 0 ? "negative" : ""}`}>{position.equityUsd > 0 ? formatPercent(roi) : "—"}</td>
                    <td className="numeric mono">{formatUsd(position.collateralValueUsd)}</td>
                    <td className="numeric mono">{formatUsd(position.debtValueUsd)}</td>
                    <td className="numeric mono">{formatUsd(position.equityUsd)}</td>
                    <td className="numeric mono"><span className={`risk-badge ${riskClass(position.debtRatio)}`}>{formatPercent(position.debtRatio)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
