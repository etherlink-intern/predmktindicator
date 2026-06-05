"use client";

import { useEffect, useRef, useState } from "react";
import type { AverageEntryPriceBucket } from "../lib/fx-dashboard";

const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

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

function formatExposure(value: number) {
  return value > 0 ? formatCompactUsd(value) : "—";
}

export function AverageEntryPriceBook({
  label,
  bucketsBySize,
  accent,
  currentPrice,
}: {
  label: "ETH" | "BTC";
  bucketsBySize: Record<number, AverageEntryPriceBucket[]>;
  accent: string;
  currentPrice: number;
}) {
  const sizes = Object.keys(bucketsBySize)
    .map(Number)
    .sort((a, b) => a - b);
  const defaultSize = label === "ETH" ? 100 : 1000;
  const [bucketSize, setBucketSize] = useState(
    sizes.includes(defaultSize) ? defaultSize : (sizes[0] ?? 200)
  );
  const rows = (bucketsBySize[bucketSize] ?? []).filter(
    (bucket) => bucket.longNotionalUsd > 0 || bucket.shortNotionalUsd > 0
  );
  const totalLong = rows.reduce((sum, bucket) => sum + bucket.longNotionalUsd, 0);
  const totalShort = rows.reduce((sum, bucket) => sum + bucket.shortNotionalUsd, 0);
  const maxLong = Math.max(1, ...rows.map((b) => b.longNotionalUsd));
  const maxShort = Math.max(1, ...rows.map((b) => b.shortNotionalUsd));
  const tableWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tableWrapRef.current || !currentPrice || rows.length === 0) return;
    const container = tableWrapRef.current;
    const rowEls = container.querySelectorAll<HTMLElement>(".avg-entry-row:not(.avg-entry-head)");
    for (let i = 0; i < rows.length; i++) {
      const bucket = rows[i];
      if (currentPrice >= bucket.bucketLowUsd && currentPrice <= bucket.bucketHighUsd) {
        const targetEl = rowEls[i];
        if (targetEl) {
          // Keep the current-price bucket centered inside the ladder only.
          // scrollIntoView can move the whole document on refresh, which made the page jump downward.
          const top = targetEl.offsetTop - container.offsetTop - container.clientHeight / 2 + targetEl.clientHeight / 2;
          container.scrollTo({ top: Math.max(0, top), behavior: "auto" });
        }
        return;
      }
    }
  }, [currentPrice, bucketSize, rows]);

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

      <div className="avg-entry-size-toggles">
        <span className="muted small" style={{ marginRight: 6 }}>
          Bucket:
        </span>
        {sizes.map((size) => (
          <button
            key={size}
            className={`avg-entry-size-btn${size === bucketSize ? " active" : ""}`}
            onClick={() => setBucketSize(size)}
          >
            ${size.toLocaleString()}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="muted small">No average entry price data yet.</p>
      ) : (
        <div className="avg-entry-table-wrap" ref={tableWrapRef}>
          <div
            className="avg-entry-ladder"
            role="table"
            aria-label={`${label} average entry price book, $${label === "ETH" ? bucketSize : bucketSize} buckets`}
          >
            <div className="avg-entry-super-row" role="row">
              <span className="avg-entry-side-label avg-entry-short-label">SHORTS</span>
              <span className="avg-entry-mid-label">AVG ENTRY PRICE</span>
              <span className="avg-entry-side-label avg-entry-long-label">LONGS</span>
            </div>
            <div className="avg-entry-row avg-entry-head" role="row">
              <span>Notional</span>
              <span>Bar</span>
              <span>Bucket</span>
              <span>Bar</span>
              <span>Notional</span>
            </div>
            {rows.map((bucket) => {
              const labelText = `${formatAverageEntryPrice(bucket.bucketLowUsd)}–${formatAverageEntryPrice(bucket.bucketHighUsd)}`;
              const shortDetail = `${formatExposure(bucket.shortNotionalUsd)} short`;
              const longDetail = `${formatExposure(bucket.longNotionalUsd)} long`;
              const shortBarWidth = bucket.shortNotionalUsd > 0 ? Math.max(3, (bucket.shortNotionalUsd / maxShort) * 100) : 0;
              const longBarWidth = bucket.longNotionalUsd > 0 ? Math.max(3, (bucket.longNotionalUsd / maxLong) * 100) : 0;
              return (
                <div className="avg-entry-row" role="row" key={`${bucket.instrument}-${bucketSize}-${bucket.bucketLowUsd}`}>
                  <span className="avg-entry-cell avg-entry-num avg-entry-short" title={shortDetail}>
                    {formatExposure(bucket.shortNotionalUsd)}
                  </span>
                  <span className="avg-entry-bar-cell" title={shortDetail}>
                    <span className="avg-entry-bar-track avg-entry-bar-track-short">
                      {shortBarWidth > 0 && (
                        <span className="avg-entry-bar avg-entry-bar-short" style={{ width: `${shortBarWidth}%` }} />
                      )}
                    </span>
                  </span>
                  <span className="avg-entry-bucket mono" title={`Average entry price bucket ${labelText}`}>
                    {labelText}
                  </span>
                  <span className="avg-entry-bar-cell" title={longDetail}>
                    <span className="avg-entry-bar-track avg-entry-bar-track-long">
                      {longBarWidth > 0 && (
                        <span className="avg-entry-bar avg-entry-bar-long" style={{ width: `${longBarWidth}%` }} />
                      )}
                    </span>
                  </span>
                  <span className="avg-entry-cell avg-entry-num avg-entry-long" title={longDetail}>
                    {formatExposure(bucket.longNotionalUsd)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
