"use client";

import { useMemo, useState } from "react";
import { formatPercent, formatUsd, type TopTrader } from "../../lib/fx-format";

type TabId = "pnl" | "roi" | "realized" | "active" | "whale";
type SortKey = "rank" | "trader" | "metric" | "totalPnl" | "unrealized" | "realized" | "winRate" | "positions" | "notional" | "debt" | "fees";
type SortDirection = "asc" | "desc";

const TABS: { id: TabId; label: string; description: string }[] = [
  {
    id: "pnl",
    label: "Top PnL",
    description:
      "Ranks wallets by total profit/loss across open and closed positions. Most profitable traders appear first; negative-PnL traders rank below all positive-PnL traders.",
  },
  {
    id: "roi",
    label: "Top ROI",
    description:
      "Return on Investment = total PnL ÷ capital used. Ranks by capital efficiency. Trader must have at least $1K in capital/notional to qualify.",
  },
  {
    id: "realized",
    label: "Realized PnL",
    description:
      "Ranks by realized (closed) profit/loss only. Excludes unrealized gains. Traders with no realized PnL data are marked n/a and ranked last.",
  },
  {
    id: "active",
    label: "Most Active",
    description:
      "Ranks by total number of positions (open + closed). This measures activity, not profitability. High position count does not imply positive returns.",
  },
  {
    id: "whale",
    label: "Whale Traders",
    description:
      "Ranks by current notional value (total exposure). This measures size, not profitability. Largest positions appear first.",
  },
];

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function PnlBar({ value, maxAbs }: { value: number; maxAbs: number }) {
  const pct = maxAbs > 0 ? Math.min(100, (Math.abs(value) / maxAbs) * 100) : 0;
  const isPositive = value >= 0;
  return (
    <span
      style={{
        display: "inline-block",
        width: 80,
        height: 6,
        borderRadius: 999,
        background: "var(--border)",
        verticalAlign: "middle",
      }}
    >
      <span
        style={{
          display: "block",
          width: `${Math.max(2, pct)}%`,
          height: "100%",
          borderRadius: 999,
          background: isPositive ? "rgba(34,197,94,0.72)" : "rgba(239,68,68,0.72)",
        }}
      />
    </span>
  );
}

function defaultRankTraders(traders: TopTrader[], tab: TabId): TopTrader[] {
  const sorted = [...traders];
  switch (tab) {
    case "pnl": {
      const positive = sorted.filter((t) => t.totalPnlUsd > 0).sort((a, b) => b.totalPnlUsd - a.totalPnlUsd || a.address.localeCompare(b.address));
      const zero = sorted.filter((t) => t.totalPnlUsd === 0).sort((a, b) => a.address.localeCompare(b.address));
      const negative = sorted.filter((t) => t.totalPnlUsd < 0).sort((a, b) => b.totalPnlUsd - a.totalPnlUsd || a.address.localeCompare(b.address));
      return [...positive, ...zero, ...negative];
    }
    case "roi":
      return sorted
        .filter((t) => Math.max(t.capitalUsedUsd, t.notionalUsd) >= 1000)
        .sort((a, b) => b.roi - a.roi || b.totalPnlUsd - a.totalPnlUsd || a.address.localeCompare(b.address));
    case "realized": {
      const withData = sorted
        .filter((t) => t.realizedPnlUsd !== 0 || t.closedPositions > 0)
        .sort((a, b) => b.realizedPnlUsd - a.realizedPnlUsd || a.address.localeCompare(b.address));
      const withoutData = sorted.filter((t) => t.realizedPnlUsd === 0 && t.closedPositions === 0).sort((a, b) => a.address.localeCompare(b.address));
      return [...withData, ...withoutData];
    }
    case "active":
      return sorted.sort((a, b) => b.totalPositions - a.totalPositions || b.notionalUsd - a.notionalUsd || a.address.localeCompare(b.address));
    case "whale":
      return sorted.sort((a, b) => b.notionalUsd - a.notionalUsd || b.totalPositions - a.totalPositions || a.address.localeCompare(b.address));
    default:
      return sorted;
  }
}

function getMetricLabel(tab: TabId): string {
  switch (tab) {
    case "pnl": return "Total PnL";
    case "roi": return "ROI";
    case "realized": return "Realized PnL";
    case "active": return "Positions";
    case "whale": return "Notional";
  }
}

function getMetricValue(t: TopTrader, tab: TabId): number {
  switch (tab) {
    case "pnl": return t.totalPnlUsd;
    case "roi": return t.roi;
    case "realized": return t.realizedPnlUsd;
    case "active": return t.totalPositions;
    case "whale": return t.notionalUsd;
  }
}

function getSortValue(t: TopTrader, key: SortKey, tab: TabId): number | string {
  switch (key) {
    case "rank": return 0;
    case "trader": return t.address;
    case "metric": return getMetricValue(t, tab);
    case "totalPnl": return t.totalPnlUsd;
    case "unrealized": return t.unrealizedPnlUsd;
    case "realized": return t.realizedPnlUsd;
    case "winRate": return t.closedPositions > 0 ? t.winRate : -1;
    case "positions": return t.totalPositions;
    case "notional": return t.notionalUsd;
    case "debt": return t.maxDebtRatio;
    case "fees": return t.feesUsd;
  }
}

function sortByHeader(traders: TopTrader[], tab: TabId, key: SortKey, direction: SortDirection) {
  if (key === "rank") return defaultRankTraders(traders, tab);
  return [...traders].sort((a, b) => {
    const av = getSortValue(a, key, tab);
    const bv = getSortValue(b, key, tab);
    let delta = 0;
    if (typeof av === "string" || typeof bv === "string") {
      delta = String(av).localeCompare(String(bv));
    } else {
      delta = av === bv ? 0 : av - bv;
    }
    if (delta === 0) delta = a.address.localeCompare(b.address);
    return direction === "asc" ? delta : -delta;
  });
}

function SortHeader({
  label,
  keyName,
  activeKey,
  direction,
  className,
  style,
  onSort,
}: {
  label: string;
  keyName: SortKey;
  activeKey: SortKey | null;
  direction: SortDirection;
  className?: string;
  style?: React.CSSProperties;
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === keyName;
  return (
    <th className={className} style={style}>
      <button
        type="button"
        className="sort-button"
        onClick={() => onSort(keyName)}
        aria-label={`Sort by ${label}`}
        title={`Sort by ${label}`}
      >
        {label}
        <span aria-hidden="true">{active ? (direction === "asc" ? " ↑" : " ↓") : ""}</span>
      </button>
    </th>
  );
}

export function TopTradersClient({ traders }: { traders: TopTrader[] }) {
  const [tab, setTab] = useState<TabId>("pnl");
  const [walletSearch, setWalletSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const activeTab = TABS.find((t) => t.id === tab)!;

  const ranked = useMemo(() => {
    const search = walletSearch.trim().toLowerCase();
    const filtered = traders.filter((trader) => {
      if (!search) return true;
      return trader.address.toLowerCase().includes(search);
    });
    return sortKey ? sortByHeader(filtered, tab, sortKey, sortDirection) : defaultRankTraders(filtered, tab);
  }, [sortDirection, sortKey, tab, traders, walletSearch]);

  const maxPnl = Math.max(1, ...ranked.map((t) => Math.abs(t.totalPnlUsd)));

  function selectTab(nextTab: TabId) {
    setTab(nextTab);
    setSortKey(null);
    setSortDirection("desc");
  }

  function updateSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "trader" ? "asc" : "desc");
  }

  return (
    <section>
      <p className="eyebrow">Rankings</p>
      <h1>Trader rankings</h1>
      <p className="muted">Select a ranking method below, search by wallet, or click a table header to sort the current results.</p>

      <div
        style={{
          display: "flex",
          gap: 4,
          marginTop: 16,
          marginBottom: 4,
          borderBottom: "1px solid var(--border)",
          paddingBottom: 0,
          overflowX: "auto",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTab(t.id)}
            style={{
              background: "none",
              border: "none",
              borderBottom: tab === t.id ? "2px solid var(--fg)" : "2px solid transparent",
              padding: "8px 16px",
              cursor: "pointer",
              color: tab === t.id ? "var(--fg)" : "var(--muted)",
              fontWeight: tab === t.id ? 700 : 500,
              fontSize: 14,
              whiteSpace: "nowrap",
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }} title={activeTab.description}>
        {activeTab.description}
      </p>

      <div className="filter-bar" aria-label="Trader ranking filters">
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
          Showing {ranked.length.toLocaleString()} of {traders.length.toLocaleString()} wallets. {sortKey ? `Sorted by table header: ${sortKey}.` : `Default tab ranking: ${activeTab.label}.`}
        </p>
      </div>

      {ranked.length === 0 ? (
        <div className="card-warning">
          <p className="muted">No trader data matches the current search.</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="compact" style={{ width: "100%", minWidth: 820 }}>
            <thead>
              <tr>
                <SortHeader label="#" keyName="rank" activeKey={sortKey} direction={sortDirection} onSort={updateSort} style={{ width: 36 }} />
                <SortHeader label="Trader" keyName="trader" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
                <SortHeader label={getMetricLabel(tab)} keyName="metric" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" style={{ width: 140 }} />
                <SortHeader label="Unrealized" keyName="unrealized" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" style={{ width: 110 }} />
                <SortHeader label="Realized" keyName="realized" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" style={{ width: 100 }} />
                <SortHeader label="Win Rate" keyName="winRate" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" style={{ width: 80 }} />
                <SortHeader label="Positions" keyName="positions" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" style={{ width: 85 }} />
                <SortHeader label="Notional" keyName="notional" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" style={{ width: 110 }} />
                <SortHeader label="Debt" keyName="debt" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" style={{ width: 75 }} />
                <SortHeader label="Fees" keyName="fees" activeKey={sortKey} direction={sortDirection} onSort={updateSort} className="numeric" style={{ width: 85 }} />
              </tr>
            </thead>
            <tbody>
              {ranked.map((t, i) => {
                const isPositive = t.totalPnlUsd >= 0;
                const metricValue = getMetricValue(t, tab);
                return (
                  <tr key={t.address}>
                    <td className="mono" style={{ fontWeight: 800 }}>#{i + 1}</td>
                    <td>
                      <a href={`/traders/${t.address}`} className="mono" style={{ textDecoration: "none" }} title={t.address}>
                        {shortAddress(t.address)}
                      </a>
                    </td>
                    <td className="numeric mono">
                      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                        <span
                          style={{
                            color: tab === "pnl" ? (isPositive ? "var(--positive)" : "var(--negative)") : "inherit",
                            fontWeight: 700,
                          }}
                        >
                          {tab === "roi"
                            ? formatPercent(t.roi)
                            : tab === "active"
                              ? t.totalPositions.toLocaleString()
                              : formatUsd(metricValue)}
                        </span>
                        {tab === "pnl" && <PnlBar value={t.totalPnlUsd} maxAbs={maxPnl} />}
                      </div>
                    </td>
                    <td className={`numeric mono ${t.unrealizedPnlUsd > 0 ? "positive" : t.unrealizedPnlUsd < 0 ? "negative" : ""}`}>
                      {formatUsd(t.unrealizedPnlUsd)}
                    </td>
                    <td className={`numeric mono ${t.realizedPnlUsd > 0 ? "positive" : t.realizedPnlUsd < 0 ? "negative" : ""}`}>
                      {t.closedPositions > 0 ? formatUsd(t.realizedPnlUsd) : <span className="muted">n/a</span>}
                    </td>
                    <td className="numeric">
                      {t.closedPositions > 0 ? (
                        <span style={{ color: t.winRate >= 0.6 ? "var(--positive)" : t.winRate >= 0.3 ? "var(--warning)" : "var(--negative)", fontWeight: 700 }}>
                          {formatPercent(t.winRate)}
                        </span>
                      ) : (
                        <span className="muted">n/a</span>
                      )}
                    </td>
                    <td className="numeric mono">{t.totalPositions}</td>
                    <td className="numeric mono">{formatUsd(t.notionalUsd)}</td>
                    <td className="numeric mono">{formatPercent(t.maxDebtRatio)}</td>
                    <td className="numeric mono">{formatUsd(t.feesUsd)}</td>
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
