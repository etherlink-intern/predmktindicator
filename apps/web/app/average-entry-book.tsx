import type { AverageEntryPriceBucket } from "../lib/fx-dashboard";
import { formatPercent, formatUsd } from "../lib/fx-dashboard";

function formatCompactUsd(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (absolute >= 1_000) return `${sign}$${Math.round(absolute / 1_000).toLocaleString()}K`;
  return `${sign}$${Math.round(absolute).toLocaleString()}`;
}

function formatAverageEntryPrice(value: number) {
  if (value >= 10_000) return `$${Math.round(value / 1000)}K`;
  if (value >= 1_000) return `$${(value / 1000).toFixed(value >= 2000 ? 1 : 2)}K`;
  return `$${Math.round(value)}`;
}

function formatCountLabel(value: number, noun: string) {
  if (value <= 0) return "—";
  return `${value.toLocaleString()} ${noun}${value === 1 ? "" : "s"}`;
}

function formatExposure(value: number) {
  return value > 0 ? formatCompactUsd(value) : "—";
}

function formatTopWalletShare(value: number) {
  if (value <= 0) return "n/a";
  return formatPercent(value);
}

export function AverageEntryPriceBook({
  label,
  buckets,
  accent,
}: {
  label: "ETH" | "BTC";
  buckets: AverageEntryPriceBucket[];
  accent: string;
}) {
  const rows = buckets.filter((bucket) => bucket.longNotionalUsd > 0 || bucket.shortNotionalUsd > 0);
  const totalLong = rows.reduce((sum, bucket) => sum + bucket.longNotionalUsd, 0);
  const totalShort = rows.reduce((sum, bucket) => sum + bucket.shortNotionalUsd, 0);
  const maxLong = Math.max(1, ...rows.map((b) => b.longNotionalUsd));
  const maxShort = Math.max(1, ...rows.map((b) => b.shortNotionalUsd));

  return (
    <article
      className="card-hero avg-entry-panel"
      title={`${label} average entry price book for currently open f(x) positions`}
    >
      <div className="avg-entry-panel-header">
        <div>
          <p className="metric-label" style={{ marginBottom: 2 }}>
            {label} Average Entry Price
          </p>
          <div className="metric-detail">Current open exposure only · sorted by price descending</div>
        </div>
        <div className="mono small avg-entry-panel-summary" style={{ color: accent }}>
          <span>Long {formatCompactUsd(totalLong)}</span>
          <span>Short {formatCompactUsd(totalShort)}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="muted small">No average entry price data yet.</p>
      ) : (
        <div className="avg-entry-table-wrap">
          <div className="avg-entry-ladder" role="table" aria-label={`${label} average entry price book`}>
            <div className="avg-entry-super-row" role="row">
              <span className="avg-entry-side-label avg-entry-short-label">SHORTS</span>
              <span className="avg-entry-mid-label">AVG ENTRY PRICE</span>
              <span className="avg-entry-side-label avg-entry-long-label">LONGS</span>
            </div>
            <div className="avg-entry-row avg-entry-head" role="row">
              <span>Wallets</span>
              <span>Positions</span>
              <span>Notional</span>
              <span>Bar</span>
              <span>Bucket</span>
              <span>Bar</span>
              <span>Notional</span>
              <span>Positions</span>
              <span>Wallets</span>
            </div>
            {rows.map((bucket) => {
              const labelText = `${formatAverageEntryPrice(bucket.bucketLowUsd)}–${formatAverageEntryPrice(bucket.bucketHighUsd)}`;
              const shortTitle = `Short side\nAverage entry price range: ${labelText}\nUnique wallets: ${bucket.shortOwners.toLocaleString()}\nOpen positions: ${bucket.shortPositions.toLocaleString()}\nOpen notional: ${formatUsd(bucket.shortNotionalUsd)}\nTop wallet share: ${formatTopWalletShare(bucket.shortTopWalletShare)}`;
              const longTitle = `Long side\nAverage entry price range: ${labelText}\nUnique wallets: ${bucket.longOwners.toLocaleString()}\nOpen positions: ${bucket.longPositions.toLocaleString()}\nOpen notional: ${formatUsd(bucket.longNotionalUsd)}\nTop wallet share: ${formatTopWalletShare(bucket.longTopWalletShare)}`;
              const shortBarWidth = bucket.shortNotionalUsd > 0 ? Math.max(3, (bucket.shortNotionalUsd / maxShort) * 100) : 0;
              const longBarWidth = bucket.longNotionalUsd > 0 ? Math.max(3, (bucket.longNotionalUsd / maxLong) * 100) : 0;
              return (
                <div className="avg-entry-row" role="row" key={`${bucket.instrument}-${bucket.bucketLowUsd}`}>
                  <span className="avg-entry-cell avg-entry-num" title={shortTitle}>{formatCountLabel(bucket.shortOwners, "wallet")}</span>
                  <span className="avg-entry-cell avg-entry-num" title={shortTitle}>{formatCountLabel(bucket.shortPositions, "position")}</span>
                  <span className="avg-entry-cell avg-entry-num avg-entry-short" title={shortTitle}>{formatExposure(bucket.shortNotionalUsd)}</span>
                  <span className="avg-entry-bar-cell" title={shortTitle}>
                    <span className="avg-entry-bar-track avg-entry-bar-track-short">
                      {shortBarWidth > 0 && <span className="avg-entry-bar avg-entry-bar-short" style={{ width: `${shortBarWidth}%` }} />}
                    </span>
                  </span>
                  <span className="avg-entry-bucket mono" title={`Average entry price bucket ${labelText}`}>{labelText}</span>
                  <span className="avg-entry-bar-cell" title={longTitle}>
                    <span className="avg-entry-bar-track avg-entry-bar-track-long">
                      {longBarWidth > 0 && <span className="avg-entry-bar avg-entry-bar-long" style={{ width: `${longBarWidth}%` }} />}
                    </span>
                  </span>
                  <span className="avg-entry-cell avg-entry-num avg-entry-long" title={longTitle}>{formatExposure(bucket.longNotionalUsd)}</span>
                  <span className="avg-entry-cell avg-entry-num" title={longTitle}>{formatCountLabel(bucket.longPositions, "position")}</span>
                  <span className="avg-entry-cell avg-entry-num" title={longTitle}>{formatCountLabel(bucket.longOwners, "wallet")}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
