import { notFound } from "next/navigation";
import { formatAddress, formatPercent, formatUsd, getPositionProfile } from "../../../lib/fx-dashboard";

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
      <h1>{position.poolName} #{position.tokenId}</h1>
      <p className="muted">
        Current position metrics are read from live f(x) pool/oracle state. They are current equity/risk marks, not
        realized historical PnL.
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
            <tr><th>Pool</th><td className="mono wrap">{position.poolAddress}</td></tr>
            <tr><th>Side</th><td><span className={`pill ${position.side}`}>{position.side}</span></td></tr>
            <tr><th>Collateral</th><td>{position.collateral}</td></tr>
            <tr><th>Oracle price</th><td>{numberFormatter.format(position.oraclePrice)}</td></tr>
            <tr><th>Raw collateral</th><td className="mono wrap">{position.rawCollateral}</td></tr>
            <tr><th>Raw debt</th><td className="mono wrap">{position.rawDebt}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
