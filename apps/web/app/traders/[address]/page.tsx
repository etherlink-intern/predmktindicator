export default async function TraderPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return (
    <section>
      <p className="eyebrow">Trader profile</p>
      <h1>{address}</h1>
      <p className="muted">Open positions, closed positions, activity timeline, risk, and behavior tags will render here.</p>
    </section>
  );
}
