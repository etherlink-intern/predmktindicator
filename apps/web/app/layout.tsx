import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "f(x) Trader Profiles",
  description: "Public dashboard for active f(x) Protocol positions and wallet-level risk metrics."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <main className="shell">
          <nav className="nav" aria-label="Primary navigation">
            <a href="/">Home</a>
            <a href="/leaderboard">Leaderboard</a>
            <a href="/methodology">Methodology</a>
            <a href="/privacy">Privacy</a>
          </nav>
          {children}
          <footer style={{
            marginTop: "36px",
            paddingTop: "14px",
            borderTop: "1px solid rgba(148, 163, 184, 0.16)",
            textAlign: "center",
            color: "var(--muted)",
            fontSize: "13px"
          }}>
            <p>Tofu Zebra Labs — building transparent on-chain tools</p>
          </footer>
        </main>
      </body>
    </html>
  );
}
