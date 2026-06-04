import { notFound } from "next/navigation";
import {
  displayPool,
  formatAddress,
  formatDate,
  formatPercent,
  formatUsd,
  getTraderProfile
} from "../../../lib/fx-dashboard";

const numberFormatter = new Intl.NumberFormat("en-US");

function netExposureTone(value: number) {
  if (Math.abs(value) < 1) return "net-exposure flat";
  return value > 0 ? "net-exposure long" : "net-exposure short";
}

function netExposureLabel(value: number) {
  if (Math.abs(value) < 1) return "Flat";
  return value > 0 ? "Net long" : "Net short";
}

function NetExposureCard({ label, longUsd, netUsd, shortUsd }: { label: string; longUsd: number; netUsd: number; shortUsd: number }) {
  return (
    <article className="card">
      <p className="muted">{label} exposure</p>
      <h2>{netExposureLabel(netUsd)}</h2>
      <p className={netExposureTone(netUsd)} title={`Long ${formatUsd(longUsd)} / Short ${formatUsd(shortUsd)}`}>
        <strong>{formatUsd(Math.abs(netUsd))}</strong>
        <small>Long {formatUsd(longUsd)} / Short {formatUsd(shortUsd)}</small>
      </p>
    </article>
  );
}

export const dynamic = "force-dynamic";

type TraderPageProps = {
  params: Promise<{ address: string }> | { address: string };
};

export default async function TraderPage({ params }: TraderPageProps) {
  const resolvedParams = await params;
  const profile = await getTraderProfile(resolvedParams.address);

  if (!profile) {
    notFound();
  }

  return (
    <section>
      <p className="eyebrow">Trader profile</p>
      <h1 className="mono">{formatAddress(profile.owner)}</h1>
      <p className="muted mono wrap">{profile.owner}</p>
      <p className="muted">
        Position values are current snapshot estimates from public f(x) contract state and oracle prices. They are not
        realized all-time profit/loss or financial advice.
      </p>

      <div className="card-grid compact">
        <article className="card">
          <p className="muted">Notional value</p>
          <h2>{formatUsd(profile.summary.notionalValueUsd)}</h2>
        </article>
        <article className="card">
          <p className="muted">Open positions</p>
          <h2>{numberFormatter.format(profile.summary.positions)}</h2>
        </article>
        <article className="card">
          <p className="muted">Current equity</p>
          <h2>{formatUsd(profile.summary.equityUsd)}</h2>
        </article>
        <article className="card">
          <p className="muted">Debt value</p>
          <h2>{formatUsd(profile.summary.debtValueUsd)}</h2>
        </article>
        <article className="card">
          <p className="muted">Max debt ratio</p>
          <h2>{formatPercent(profile.summary.maxDebtRatio)}</h2>
        </article>
        <NetExposureCard
          label="ETH"
          longUsd={profile.summary.ethLongExposureUsd}
          netUsd={profile.summary.ethNetExposureUsd}
          shortUsd={profile.summary.ethShortExposureUsd}
        />
        <NetExposureCard
          label="BTC"
          longUsd={profile.summary.btcLongExposureUsd}
          netUsd={profile.summary.btcNetExposureUsd}
          shortUsd={profile.summary.btcShortExposureUsd}
        />
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Open positions</p>
          <h2>Current position marks</h2>
        </div>
        <p className="muted">Snapshot: {formatDate(profile.generatedAt)}</p>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Position</th>
              <th>Market</th>
              <th>Side</th>
              <th>Oracle price</th>
              <th>Collateral value</th>
              <th>Debt value</th>
              <th>Current equity</th>
              <th>Debt ratio</th>
            </tr>
          </thead>
          <tbody>
            {profile.positions.map((position) => (
              <tr key={`${position.poolAddress}:${position.tokenId}`}>
                <td>
                  <a className="mono" href={`/positions/${position.poolAddress}-${position.tokenId}`}>#{position.tokenId}</a>
                </td>
                <td>{displayPool(position.poolName)}</td>
                <td><span className={`pill ${position.side}`}>{position.side}</span></td>
                <td>{numberFormatter.format(position.oraclePrice)}</td>
                <td>{formatUsd(position.collateralValueUsd)}</td>
                <td>{formatUsd(position.debtValueUsd)}</td>
                <td>{formatUsd(position.equityUsd)}</td>
                <td>{formatPercent(position.debtRatio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
