import type { Metadata } from "next";
import "./globals.css";
import { ThemeToggle } from "./theme-toggle";

export const metadata: Metadata = {
  title: "f(x) Trader Profiles",
  description: "Public dashboard for active f(x) Protocol positions and wallet-level risk metrics."
};

export const dynamic = "force-dynamic";

function ThemeScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function() {
            try {
              var theme = localStorage.getItem('fx-theme');
              if (!theme) {
                theme = window.matchMedia('(prefers-color-scheme:light)').matches ? 'light' : 'dark';
                localStorage.setItem('fx-theme', theme);
              }
              document.documentElement.setAttribute('data-theme', theme);
            } catch(e) {}
          })();
        `.trim(),
      }}
    />
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <main className="shell">
          <nav className="nav" aria-label="Primary navigation">
            <a href="/">Dashboard</a>
            <a href="/positions">Positions</a>
            <a href="/top-traders">Traders</a>
            <a href="/research">Research</a>
            <a href="/methodology">Methodology</a>
            <a href="/privacy">Privacy</a>
            <span className="nav-spacer" />
            <a
              className="nav-cta"
              href="https://fx.aladdin.club/v2/trade/?code=kitsune"
              target="_blank"
              rel="noopener noreferrer"
              title="Trade on f(x) Protocol via Aladdin"
            >
              Trade on f(x) ↗
            </a>
            <a
              className="nav-external"
              href="https://fxprotocolstats.com"
              target="_blank"
              rel="noopener noreferrer"
              title="Third-party dashboard — not affiliated"
            >
              Protocol stats <sup style={{ fontSize: "9px" }}>3rd party</sup> ↗
            </a>
            <ThemeToggle />
          </nav>
          {children}
          <footer className="site-footer">
            <p>Tofu Zebra Labs — building transparent on-chain tools</p>
          </footer>
        </main>
      </body>
    </html>
  );
}
