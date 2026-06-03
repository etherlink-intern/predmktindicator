export default async function PositionPage({ params }: { params: Promise<{ positionId: string }> }) {
  const { positionId } = await params;
  return (
    <section>
      <p className="eyebrow">Position</p>
      <h1>{positionId}</h1>
      <p className="muted">Lifecycle, collateral/debt state, tick movement history, and transactions will render here.</p>
    </section>
  );
}
