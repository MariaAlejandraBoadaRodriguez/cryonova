import type { Metadata } from "next";
import { CatalogBrowser } from "@/components/catalog/CatalogBrowser";
import styles from "@/components/catalog/catalog.module.css";

export const metadata: Metadata = {
  title: "Variable catalog · Cryonova",
  description: "Every live-verified variable and derived series by data source, with codes, units, products, resolution, coverage and each connector's live status.",
};

/**
 * The catalog renders at build time from the curated catalog; only the
 * connectors' live status is fetched in the browser, so slow probes never
 * delay the page.
 */
export default function CatalogPage() {
  return (
    <div className={styles.page}>
      <p className={styles.kicker}>Catalog</p>
      <h1 className={styles.title}>Variable catalog</h1>
      <p className={styles.lead}>
        Every live-verified variable and derived series Cryonova can analyse, grouped by data source. Each entry gives the provider code, what it measures, its units, product and version, resolution, coverage and the connector’s live status.
      </p>
      <p className={styles.lead}>
        <strong>Add to investigation</strong> sends a variable to the investigation setup open in another tab of this browser (the workspace that opened this page).
      </p>
      <CatalogBrowser />
    </div>
  );
}
