/** Formatting shared by the UI, CSV/PDF reports and the agent's verifier. */
import type { BBox } from "@/src/catalog/regions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmt(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const fixed = value.toFixed(decimals);
  return fixed === `-${(0).toFixed(decimals)}` ? (0).toFixed(decimals) : fixed;
}

export function fmtSigned(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const text = fmt(value, decimals);
  return value > 0 && Number(text) !== 0 ? `+${text}` : text;
}

export function fmtP(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  if (p < 0.001) return "< 0.001";
  return p.toFixed(3);
}

export function fmtMonth(ym: string): string {
  const [year, month] = ym.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

function lat(value: number): string {
  return `${Math.abs(value).toFixed(2)}°${value < 0 ? "S" : "N"}`;
}

function lon(value: number): string {
  return `${Math.abs(value).toFixed(2)}°${value < 0 ? "W" : "E"}`;
}

export function fmtBBox(bbox: BBox): string {
  return `${lat(bbox.south)} to ${lat(bbox.north)}, ${lon(bbox.west)} to ${lon(bbox.east)}${bbox.west > bbox.east ? " (crosses 180°)" : ""}`;
}

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${iso.replace("T", " ").slice(0, 19)} UTC`;
}

const DECIMALS: Record<string, number> = {
  temperature: 2, precip_rate: 3, pressure: 2, specific_humidity: 3, water_column: 3, wind: 3,
  energy_flux: 2, fraction: 4, percent: 2, optical_depth: 4, height: 1, ozone: 2, snow_mass: 2,
};

/** Display precision per unit group, shared by UI, reports and the agent verifier. */
export function decimalsFor(unitGroup: string): number {
  return DECIMALS[unitGroup] ?? 3;
}
