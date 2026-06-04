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
        </main>
      </body>
    </html>
  );
}
