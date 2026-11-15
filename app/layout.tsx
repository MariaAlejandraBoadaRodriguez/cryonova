import "@fontsource/overpass/400.css";
import "@fontsource/overpass/600.css";
import "@fontsource/overpass/700.css";
import "@fontsource/overpass/800.css";
import "@fontsource/fira-sans/400.css";
import "@fontsource/fira-sans/500.css";
import "@fontsource/fira-sans/600.css";
import "@fontsource/fira-sans/700.css";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/500.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Cryonova · Earth Trend Detective",
  description: "Turn questions into reproducible analyses of live NASA data, with trends, uncertainty and provenance.",
};

export const viewport: Viewport = { themeColor: "#07173F", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header on-dark">
          <div className="inner">
            <Link href="/" className="brand" aria-label="Cryonova, Earth Trend Detective: new investigation">
              <span className="brand-mark" aria-hidden="true" />
              <span className="brand-title">Cryonova</span>
              <span className="brand-sub" aria-hidden="true">
                / Earth Trend Detective
              </span>
            </Link>
            <nav aria-label="Main">
              <Link href="/">New investigation</Link>
              <Link href="/open">Open with code</Link>
              <Link href="/sources">Data sources</Link>
            </nav>
            <span className="brand-tagline">NASA Earth data · Trend investigations</span>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          Data read live from NASA Earthdata (GES DISC: MERRA-2, GPM IMERG). Built for the NASA Space Apps Challenge 2026 · Earth System Trend Detective.
        </footer>
      </body>
    </html>
  );
}
