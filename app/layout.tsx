import "@fontsource/overpass/400.css";
import "@fontsource/overpass/600.css";
import "@fontsource/overpass/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Cryonova · Earth system trend research",
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
            <Link href="/" className="brand" aria-label="Cryonova home">
              <span className="brand-mark" aria-hidden="true" />
              Cryonova
            </Link>
            <nav aria-label="Main">
              <Link href="/investigate">New investigation</Link>
              <Link href="/#open-with-code">Open with code</Link>
            </nav>
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
