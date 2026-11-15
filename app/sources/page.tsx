import type { Metadata } from "next";
import Link from "next/link";
import { TableWrap } from "@/components/TableWrap";
import { connectorStatus } from "@/src/providers/status";
import { fmt, fmtUtc } from "@/src/lib/format";

export const metadata: Metadata = { title: "Data sources · Cryonova" };
export const dynamic = "force-dynamic";

const LABEL = { verified_live: "Verified live", reachable: "Reachable", configured: "Configured, not integrated", pending: "Pending", error: "Error" } as const;

export default async function SourcesPage() {
  const connectors = await connectorStatus();
  return (
    <div className="page stack" style={{ paddingTop: 24 }}>
      <h1 style={{ fontSize: "1.6rem" }}>Data sources and connector status</h1>
      <p className="muted">
        Checked live when this page loads (cached for 5 minutes). “Verified live” means a real value came back from the provider: read by this page’s probe, or, for the asynchronous Copernicus CDS and Giovanni services, by a run in the last 7 days.
      </p>
      <TableWrap label="Connector status">
        <table className="data" data-testid="connector-table">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
              <th scope="col">Last real value</th>
              <th scope="col">Latest data</th>
              <th scope="col">Detail</th>
              <th scope="col">Checked</th>
            </tr>
          </thead>
          <tbody>
            {connectors.map((c) => (
              <tr key={c.id} data-testid={`connector-${c.id}`}>
                <th scope="row" style={{ whiteSpace: "normal" }}>
                  {c.name}
                  <div className="field-help">{c.role}</div>
                </th>
                <td>
                  <span className={c.state === "verified_live" ? "badge badge-strong" : "badge badge-neutral"}>{LABEL[c.state]}</span>
                </td>
                <td style={{ whiteSpace: "normal", minWidth: 220 }}>
                  {c.lastValue ? (
                    <>
                      <strong className="mono">
                        {fmt(c.lastValue.value, Math.abs(c.lastValue.value) >= 100 ? 1 : 3)} {c.lastValue.units}
                      </strong>
                      <div className="field-help">{c.lastValue.label}</div>
                      <div className="field-help">
                        {c.lastValue.source === "run" && c.lastValue.runId ? <Link href={`/investigations/${c.lastValue.runId}`}>from a run</Link> : "from this page’s probe"} · {fmtUtc(c.lastValue.checkedAt)}
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="mono">{c.latestData ?? "—"}</td>
                <td style={{ whiteSpace: "normal", minWidth: 280 }}>{c.detail}</td>
                <td className="mono">{fmtUtc(c.checkedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}
