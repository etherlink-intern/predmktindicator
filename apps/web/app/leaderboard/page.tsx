export default function LeaderboardPage() {
  return (
    <section>
      <p className="eyebrow">Leaderboard</p>
      <h1>Trader leaderboard</h1>
      <p className="muted">All / 30D / 7D / 1D performance tables will read from Postgres-backed snapshots and derived metrics.</p>
      <div className="card">
        <code>GET /api/traders?period=7d&amp;sort=pnl</code>
      </div>
    </section>
  );
}
