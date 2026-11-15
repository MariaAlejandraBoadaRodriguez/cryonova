"use client";

/**
 * Point data for station variables (NOAA GSOM): a map of the stations inside
 * the area (bundled country borders, no tiles or CDN) and an accessible table
 * with each station's record, mean and trend.
 */
import { geoEquirectangular, geoPath } from "d3-geo";
import { useMemo } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import topology from "world-atlas/countries-110m.json";
import type { RunResult, VariableResult } from "@/src/jobs/types";
import { fmt, fmtMonth, fmtP, fmtSigned } from "@/src/lib/format";
import { decimalsOf } from "./charts";
import { TableWrap } from "./TableWrap";

const WIDTH = 560;
const HEIGHT = 360;

const countries = feature(topology as unknown as Topology, (topology as unknown as Topology).objects.countries as GeometryCollection);

export function StationPanel({ v, result }: { v: VariableResult; result: RunResult }) {
  const stations = useMemo(() => v.stations ?? [], [v.stations]);
  const { bbox } = result.region;
  const d = decimalsOf(v);
  const map = useMemo(() => {
    const pad = Math.max(0.5, (bbox.north - bbox.south) * 0.08);
    const west = bbox.west - pad;
    const east = (bbox.east < bbox.west ? bbox.east + 360 : bbox.east) + pad;
    const frame: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[west, bbox.south - pad], [east, bbox.north + pad]] },
    };
    const projection = geoEquirectangular().fitExtent([[8, 8], [WIDTH - 8, HEIGHT - 8]], frame);
    const path = geoPath(projection);
    const box = path({ type: "Polygon", coordinates: [[[bbox.west, bbox.south], [bbox.west, bbox.north], [bbox.east, bbox.north], [bbox.east, bbox.south], [bbox.west, bbox.south]]] } as GeoJSON.Polygon) ?? "";
    return { projection, borders: path(countries) ?? "", box };
  }, [bbox]);

  if (stations.length === 0) {
    return <p className="muted">No station inside the area returned observations for this variable and period.</p>;
  }
  const used = stations.filter((s) => s.usedInRegionalMean).length;
  return (
    <section className="stack" aria-label={`Stations for ${v.name.en}`} data-testid={`stations-${v.key}`}>
      <h4 className="plan-subtitle">Station observations (point data)</h4>
      <figure className="station-map" aria-label={`Map of ${stations.length} stations inside the area; ${used} form the regional mean`} style={{ margin: 0 }}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-hidden="true" style={{ background: "var(--ice)", borderRadius: "var(--radius)", maxWidth: WIDTH }}>
          <path d={map.borders} fill="#e3ebf3" stroke="var(--border-strong)" strokeWidth={0.6} />
          <path d={map.box} fill="none" stroke="var(--electric)" strokeDasharray="4 3" strokeWidth={1.2} />
          {stations.map((s) => {
            const [x, y] = map.projection([s.lon, s.lat]) ?? [0, 0];
            return (
              <g key={s.id} transform={`translate(${x},${y})`}>
                <circle r={6} fill={s.usedInRegionalMean ? "var(--electric)" : "var(--white)"} stroke="var(--electric)" strokeWidth={2} />
                <title>{`${s.name}: ${s.monthsValid} months, mean ${s.mean === null ? "—" : fmt(s.mean, d)} ${v.analysis.units}`}</title>
              </g>
            );
          })}
        </svg>
        <figcaption className="field-help">
          ● stations in the regional mean ({used}) · ○ other stations with data ({stations.length - used}). Dashed line: the selected area.
        </figcaption>
      </figure>
      <TableWrap label={`Stations for ${v.name.en}`}>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Station</th>
              <th scope="col">Lat, lon</th>
              <th scope="col">Elevation</th>
              <th scope="col">Months with data</th>
              <th scope="col">Mean ({v.analysis.units})</th>
              <th scope="col">Trend ({v.analysis.trendUnits})</th>
              <th scope="col">In regional mean</th>
            </tr>
          </thead>
          <tbody>
            {stations.map((s) => (
              <tr key={s.id}>
                <th scope="row" style={{ whiteSpace: "normal" }}>
                  {s.name}
                  <div className="field-help mono">{s.id}</div>
                </th>
                <td className="mono">
                  {s.lat.toFixed(3)}, {s.lon.toFixed(3)}
                </td>
                <td className="mono">{s.elevation === null ? "—" : `${Math.round(s.elevation)} m`}</td>
                <td>
                  {s.monthsValid}
                  <div className="field-help">
                    {s.firstMonth ? fmtMonth(s.firstMonth) : "—"} – {s.lastMonth ? fmtMonth(s.lastMonth) : "—"}
                  </div>
                </td>
                <td className="mono">{s.mean === null ? "—" : fmt(s.mean, d)}</td>
                <td className="mono">{s.trendPerDecade === null ? "too short" : `${fmtSigned(s.trendPerDecade, d)} (p ${fmtP(s.trendPValue ?? 1)})`}</td>
                <td>{s.usedInRegionalMean ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </section>
  );
}
