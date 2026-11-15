import "@fontsource/overpass/400.css";
import "@fontsource/overpass/400-italic.css";
import "@fontsource/overpass/600.css";
import "@fontsource/overpass/700.css";
import "@fontsource/fira-sans/700.css";
import "@fontsource/fira-sans/900.css";
import "@fontsource/fira-code/400.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
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
              <span className="brand-text" aria-hidden="true">
                <span className="brand-title">Cryonova</span>
                <span className="brand-sub">· Earth Trend Detective</span>
              </span>
            </Link>
            <SiteNav />
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
