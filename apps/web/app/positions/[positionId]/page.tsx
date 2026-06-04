import { notFound } from "next/navigation";
import {
  displayInstrument,
  displayPool,
  formatAddress,
  formatPercent,
  formatUsd,
  getPositionProfile
} from "../../../lib/fx-dashboard";

const numberFormatter = new Intl.NumberFormat("en-US");

export const dynamic = "force-dynamic";

type PositionPageProps = {
  params: Promise<{ positionId: string }> | { positionId: string };
};

export default async function PositionPage({ params }: PositionPageProps) {
  const resolvedParams = await params;
  const position = await getPositionProfile(resolvedParams.positionId);

  if (!position) {
    notFound();
  }

  return (
    <section>
      <p className="eyebrow">Position</p>
      <h1>{displayPool(position.poolName)} #{position.tokenId}</h1>
      <p className="muted">
        Current position metrics are calculated from public f(x) contract state and oracle prices. They are snapshot
        estimates, not realized historical profit/loss or financial advice.
      </p>

      <div className="card-grid compact">
        <article className="card">
          <p className="muted">Current equity</p>
          <h2>{formatUsd(position.equityUsd)}</h2>
        </article>
        <article className="card">
          <p className="muted">Collateral value</p>
          <h2>{formatUsd(position.collateralValueUsd)}</h2>
        </article>
        <article className="card">
          <p className="muted">Debt value</p>
          <h2>{formatUsd(position.debtValueUsd)}</h2>
        </article>
        <article className="card">
          <p className="muted">Debt ratio</p>
          <h2>{formatPercent(position.debtRatio)}</h2>
        </article>
      </div>

      <div className="table-card">
        <table>
          <tbody>
            <tr><th>Owner</th><td><a className="mono" href={`/traders/${position.owner}`}>{formatAddress(position.owner)}</a></td></tr>
            <tr><th>Market</th><td>{displayPool(position.poolName)}</td></tr>
            <tr><th>Pool address</th><td className="mono wrap">{position.poolAddress}</td></tr>
            <tr><th>Side</th><td><span className={`pill ${position.side}`}>{position.side}</span></td></tr>
            <tr><th>Instrument</th><td>{displayInstrument(position.collateral)}</td></tr>
            <tr><th>Oracle price</th><td>{numberFormatter.format(position.oraclePrice)}</td></tr>
            <tr><th>On-chain collateral amount</th><td className="mono wrap">{position.rawCollateral}</td></tr>
            <tr><th>On-chain debt amount</th><td className="mono wrap">{position.rawDebt}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
