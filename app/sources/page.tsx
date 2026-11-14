import type { Metadata } from "next";
import { connectorStatus } from "@/src/providers/status";
import { fmtUtc } from "@/src/lib/format";

export const metadata: Metadata = { title: "Data sources · Cryonova" };
export const dynamic = "force-dynamic";

const LABEL = { verified_live: "Verified live", reachable: "Reachable", configured: "Configured, not integrated", pending: "Pending", error: "Error" } as const;

export default async function SourcesPage() {
  const connectors = await connectorStatus();
  return (
    <div className="page stack" style={{ paddingTop: 24 }}>
      <h1 style={{ fontSize: "1.6rem" }}>Data sources and connector status</h1>
      <p className="muted">Checked live when this page loads (cached for 5 minutes). Only connectors marked “Verified live” are used to answer investigations.</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
              <th scope="col">Latest data</th>
              <th scope="col">Detail</th>
              <th scope="col">Checked</th>
            </tr>
          </thead>
          <tbody>
            {connectors.map((c) => (
              <tr key={c.id}>
                <th scope="row" style={{ whiteSpace: "normal" }}>
                  {c.name}
                  <div className="field-help">{c.role}</div>
                </th>
                <td>
                  <span className={c.state === "verified_live" ? "badge badge-strong" : "badge badge-neutral"}>{LABEL[c.state]}</span>
                </td>
                <td className="mono">{c.latestData ?? "—"}</td>
                <td style={{ whiteSpace: "normal", minWidth: 280 }}>{c.detail}</td>
                <td className="mono">{fmtUtc(c.checkedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
