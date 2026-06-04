import { notFound } from "next/navigation";
import { formatAddress, formatDate, formatPercent, formatUsd, getTraderProfile } from "../../../lib/fx-dashboard";

const numberFormatter = new Intl.NumberFormat("en-US");

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
        Position-level values are computed from live f(x) pool state and pool oracle prices. This page shows current
        mark-to-oracle equity, not realized all-time PnL. Historical realized PnL requires indexing manager operation
        events from chain.
      </p>

      <div className="card-grid compact">
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
              <th>Pool</th>
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
                <td>{position.poolName}</td>
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
