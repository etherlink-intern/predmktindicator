const cards = [
  ["Tracked traders", "Seed snapshots pending"],
  ["Active positions", "Subgraph sync pending"],
  ["Total volume", "Methodology pending"],
  ["Data freshness", "See /api/health"]
];

export default function HomePage() {
  return (
    <section>
      <p className="eyebrow">f(x) Protocol</p>
      <h1>fx-trader-profiles</h1>
      <p className="muted">
        Self-hostable web/API shell for the trader-profile dashboard. Ethereum event indexing remains hosted on Goldsky for the MVP.
      </p>
      <div className="card-grid">
        {cards.map(([label, value]) => (
          <article className="card" key={label}>
            <p className="muted">{label}</p>
            <h2>{value}</h2>
          </article>
        ))}
      </div>
    </section>
  );
}
