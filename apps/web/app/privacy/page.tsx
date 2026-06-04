export default function PrivacyPage() {
  return (
    <section>
      <p className="eyebrow">Privacy Policy</p>
      <h1>No user data collection</h1>
      <p className="muted">
        This dashboard is designed as a read-only blockchain data viewer. We do not ask users to create accounts,
        connect wallets, submit personal information, or provide contact details.
      </p>

      <div className="card-grid compact">
        <article className="card">
          <p className="eyebrow">Data collection</p>
          <h2>We do not collect personal data</h2>
          <p className="muted">
            The app does not include sign-up forms, wallet connection flows, email capture, tracking pixels, or
            behavioral analytics. We do not sell, share, or profile user data because the app does not collect it.
          </p>
        </article>
        <article className="card">
          <p className="eyebrow">Data source</p>
          <h2>Public blockchain only</h2>
          <p className="muted">
            Trader profiles, positions, collateral, debt, equity, and risk metrics are derived from public Ethereum
            blockchain reads against verified f(x) Protocol contracts.
          </p>
        </article>
        <article className="card">
          <p className="eyebrow">Cookies</p>
          <h2>No app cookies</h2>
          <p className="muted">
            The dashboard does not set application cookies for tracking, personalization, advertising, or account
            sessions.
          </p>
        </article>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">What appears on the site</p>
          <h2>Blockchain data is public by design</h2>
        </div>
      </div>
      <div className="card">
        <p className="muted">
          Wallet addresses, token IDs, position ownership, collateral amounts, debt amounts, oracle marks, and related
          risk calculations shown on this site come from public blockchain state. This information is already visible
          on Ethereum and through public block explorers. The site only indexes, formats, and summarizes that public
          data for easier reading.
        </p>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">No user submissions</p>
          <h2>No forms, accounts, or wallet connections</h2>
        </div>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Policy</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Accounts</td>
              <td>No accounts are created or stored.</td>
            </tr>
            <tr>
              <td>Wallets</td>
              <td>Users do not connect wallets to use the dashboard.</td>
            </tr>
            <tr>
              <td>Personal information</td>
              <td>No names, emails, phone numbers, addresses, or payment details are requested.</td>
            </tr>
            <tr>
              <td>Analytics</td>
              <td>No application-level analytics or behavioral tracking is used.</td>
            </tr>
            <tr>
              <td>Advertising</td>
              <td>No advertising cookies, retargeting pixels, or ad-network identifiers are used.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Infrastructure note</p>
          <h2>Serving a web page may process request metadata</h2>
        </div>
      </div>
      <div className="card warning">
        <p className="muted">
          The application itself does not collect user data. As with any website, the hosting or networking layer may
          temporarily process basic request metadata such as IP address, user agent, timestamp, and requested URL to
          deliver the page, prevent abuse, or maintain security. That metadata is not used by this app to identify,
          track, profile, or market to users.
        </p>
      </div>

      <div className="section-header">
        <div>
          <p className="eyebrow">Contact</p>
          <h2>Questions</h2>
        </div>
      </div>
      <p className="muted">
        If the app later adds accounts, wallet connections, analytics, forms, or any non-public data source, this
        policy should be updated before those features are released.
      </p>
    </section>
  );
}
