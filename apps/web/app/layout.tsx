import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "fx-trader-profiles",
  description: "Trader-profile dashboard for f(x) Protocol wallets"
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
