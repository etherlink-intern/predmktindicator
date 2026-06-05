"use client";

import { useState } from "react";
import { formatPercent, formatUsd, type TopTrader } from "../../lib/fx-dashboard";

type TabId = "pnl" | "roi" | "realized" | "active" | "whale";

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
      "Return on Investment = total PnL ÷ capital used. Ranks by capital efficiency. Trader must have at least $1K in capital to qualify.",
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

function sortTraders(traders: TopTrader[], tab: TabId): TopTrader[] {
  const sorted = [...traders];
  switch (tab) {
    case "pnl": {
      const positive = sorted.filter((t) => t.totalPnlUsd > 0).sort((a, b) => b.totalPnlUsd - a.totalPnlUsd);
      const zero = sorted.filter((t) => t.totalPnlUsd === 0);
      const negative = sorted.filter((t) => t.totalPnlUsd < 0).sort((a, b) => b.totalPnlUsd - a.totalPnlUsd);
      return [...positive, ...zero, ...negative].slice(0, 10);
    }
    case "roi":
      return sorted
        .filter((t) => Math.max(t.capitalUsedUsd, t.notionalUsd) >= 1000)
        .sort((a, b) => b.roi - a.roi)
        .slice(0, 10);
    case "realized": {
      const withData = sorted
        .filter((t) => t.realizedPnlUsd !== 0 || t.closedPositions > 0)
        .sort((a, b) => b.realizedPnlUsd - a.realizedPnlUsd);
      const withoutData = sorted.filter((t) => t.realizedPnlUsd === 0 && t.closedPositions === 0);
      return [...withData, ...withoutData].slice(0, 10);
    }
    case "active":
      return sorted.sort((a, b) => b.totalPositions - a.totalPositions).slice(0, 10);
    case "whale":
      return sorted.sort((a, b) => b.notionalUsd - a.notionalUsd).slice(0, 10);
    default:
      return sorted.slice(0, 10);
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

export function TopTradersClient({ traders }: { traders: TopTrader[] }) {
  const [tab, setTab] = useState<TabId>("pnl");

  const ranked = sortTraders(traders, tab);
  const activeTab = TABS.find((t) => t.id === tab)!;
  const maxPnl = Math.max(1, ...ranked.map((t) => Math.abs(t.totalPnlUsd)));

  return (
    <section>
      <p className="eyebrow">Rankings</p>
      <h1>Top 10 Traders</h1>
      <p className="muted">Select a ranking method below. Each tab sorts traders by a different dimension of performance.</p>

      {/* Tab bar */}
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
            onClick={() => setTab(t.id)}
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

      {/* Tab description */}
      <p className="muted small" style={{ marginBottom: 16, lineHeight: 1.5 }} title={activeTab.description}>
        {activeTab.description}
      </p>

      {ranked.length === 0 ? (
        <div className="card-warning">
          <p className="muted">No trader data available yet. Rankings will appear after positions are synced.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="compact" style={{ width: "100%", minWidth: 680 }}>
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Trader</th>
                <th className="numeric" style={{ width: 140 }}>{getMetricLabel(tab)}</th>
                <th className="numeric" style={{ width: 100 }}>Realized</th>
                <th className="numeric" style={{ width: 80 }}>Win Rate</th>
                <th className="numeric" style={{ width: 85 }}>Positions</th>
                <th className="numeric" style={{ width: 110 }}>Notional</th>
                <th className="numeric" style={{ width: 75 }}>Debt</th>
                <th className="numeric" style={{ width: 85 }}>Fees</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((t, i) => {
                const isPositive = t.totalPnlUsd >= 0;
                const rankColor = i < 3 ? "var(--gold)" : "inherit";
                return (
                  <tr key={t.address}>
                    <td className="mono" style={{ fontWeight: 800, color: rankColor }}>{i + 1}</td>
                    <td>
                      <a href={`/traders/${t.address}`} className="mono" style={{ textDecoration: "none" }}>
                        {shortAddress(t.address)}
                      </a>
                    </td>
                    <td className="numeric mono">
                      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                        <span
                          style={{
                            color: tab === "pnl" ? (isPositive ? "var(--green)" : "var(--red)") : "inherit",
                            fontWeight: 700,
                          }}
                        >
                          {tab === "roi"
                            ? formatPercent(t.roi)
                            : tab === "active"
                              ? t.totalPositions.toLocaleString()
                              : formatUsd(getMetricValue(t, tab))}
                        </span>
                        {tab === "pnl" && <PnlBar value={t.totalPnlUsd} maxAbs={maxPnl} />}
                      </div>
                    </td>
                    <td className={`numeric mono ${t.realizedPnlUsd > 0 ? "positive" : t.realizedPnlUsd < 0 ? "negative" : ""}`}>
                      {t.closedPositions > 0 ? formatUsd(t.realizedPnlUsd) : <span className="muted">n/a</span>}
                    </td>
                    <td className="numeric">
                      {t.closedPositions > 0 ? (
                        <span style={{ color: t.winRate >= 0.6 ? "var(--green)" : t.winRate >= 0.3 ? "var(--amber)" : "var(--red)", fontWeight: 700 }}>
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
