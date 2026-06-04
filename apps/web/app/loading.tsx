export default function Loading() {
  return (
    <section>
      <p className="eyebrow">f(x) Protocol</p>
      <h1>Live f(x) trader profiles</h1>
      <div className="market-terminal skeleton-terminal" aria-label="Loading market overview">
        <div className="market-hero-grid">
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="market-panel skeleton-panel" key={index}>
              <span className="skeleton-line short" />
              <span className="skeleton-line value" />
              <span className="skeleton-line" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
