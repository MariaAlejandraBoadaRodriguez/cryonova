"use client";

/**
 * Interactive orthographic globe (canvas + d3-geo + world-atlas).
 *
 * Drag to rotate, scroll or pinch to zoom, click a country to select it, or
 * switch to drawing mode and drag a rectangle. The active location gets a
 * yellow outline. Every action has a keyboard path: the globe itself takes
 * arrow keys and +/-, and the setup column offers the country list and
 * coordinate fields.
 */
import { geoCentroid, geoContains, geoDistance, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import topology from "world-atlas/countries-110m.json";
import type { BBox } from "@/src/catalog/regions";
import { cornersToBBox } from "@/src/lib/geo";

type CountryFeature = GeoJSON.Feature<GeoJSON.Geometry, { name: string }> & { id?: string | number };

export interface GlobeMarker {
  id: string;
  label: string;
  lon: number;
  lat: number;
}

interface GlobeProps {
  activeCountryNumeric: string | null;
  activeBox: BBox | null;
  drawing: boolean;
  showOutlines: boolean;
  markers: GlobeMarker[];
  focusKey: string;
  onPickCountry: (numeric: string, name: string) => void;
  onDrawBox: (bbox: BBox) => void;
  onPickMarker: (marker: GlobeMarker) => void;
}

const COLORS = {
  oceanInner: "#1f5fbf",
  oceanOuter: "#0a2a6e",
  land: "#6f8f5e",
  landShade: "#5b7a4c",
  border: "rgba(255,255,255,0.42)",
  graticule: "rgba(255,255,255,0.08)",
  glow: "rgba(46,150,245,0.55)",
  active: "#EAFE07",
  activeFill: "rgba(234,254,7,0.22)",
  marker: "#2E96F5",
};

const topo = topology as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const COUNTRIES = (feature(topo, topo.objects.countries) as unknown as GeoJSON.FeatureCollection<GeoJSON.Geometry, { name: string }>).features as CountryFeature[];
const BORDERS = mesh(topo, topo.objects.countries, (a, b) => a !== b);
const GRATICULE = geoGraticule10();

/** A lat/lon box as a ring sampled along parallels and meridians (correct on the sphere). */
export function boxRing(bbox: BBox, steps = 24): GeoJSON.Polygon {
  const east = bbox.west > bbox.east ? bbox.east + 360 : bbox.east;
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) ring.push([bbox.west + ((east - bbox.west) * i) / steps, bbox.south]);
  for (let i = 1; i <= steps; i += 1) ring.push([east, bbox.south + ((bbox.north - bbox.south) * i) / steps]);
  for (let i = 1; i <= steps; i += 1) ring.push([east - ((east - bbox.west) * i) / steps, bbox.north]);
  for (let i = 1; i < steps; i += 1) ring.push([bbox.west, bbox.north - ((bbox.north - bbox.south) * i) / steps]);
  ring.push(ring[0]!);
  // GeoJSON rings are counter-clockwise for the interior on the sphere in d3-geo.
  return { type: "Polygon", coordinates: [ring.reverse()] };
}

function boxCenter(bbox: BBox): [number, number] {
  const east = bbox.west > bbox.east ? bbox.east + 360 : bbox.east;
  let lon = (bbox.west + east) / 2;
  if (lon > 180) lon -= 360;
  return [lon, (bbox.south + bbox.north) / 2];
}

export function Globe(props: GlobeProps) {
  const { activeCountryNumeric, activeBox, drawing, showOutlines, markers, focusKey, onPickCountry, onDrawBox, onPickMarker } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 600, height: 520 });
  const [rotation, setRotation] = useState<[number, number]>([20, -10]);
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState<BBox | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; label: string } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; rotation: [number, number]; zoom: number; distance: number; moved: boolean; drawStart: [number, number] | null } | null>(null);

  const radius = Math.max(80, (Math.min(size.width, size.height) / 2 - 18) * zoom);
  const projection = useMemo(
    () => geoOrthographic().translate([size.width / 2, size.height / 2]).scale(radius).rotate([-rotation[0], -rotation[1], 0]).clipAngle(90).precision(0.4),
    [size, radius, rotation],
  );

  const activeFeature = useMemo(() => COUNTRIES.find((f) => activeCountryNumeric !== null && String(f.id).padStart(3, "0") === activeCountryNumeric) ?? null, [activeCountryNumeric]);

  // Size the canvas to its container.
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry?.contentRect.width ?? 600);
      setSize({ width, height: Math.round(Math.max(320, Math.min(640, width * 0.86))) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Turn toward a location chosen elsewhere (country list, assistant, coordinates).
  useEffect(() => {
    const target: [number, number] | null = activeFeature ? (geoCentroid(activeFeature as GeoPermissibleObjects) as [number, number]) : activeBox ? boxCenter(activeBox) : null;
    if (!target) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let start: number | null = null;
    let from: [number, number] | null = null;
    const step = (t: number) => {
      if (start === null) start = t;
      setRotation((current) => {
        from ??= current;
        const k = reduce ? 1 : Math.min(1, (t - (start as number)) / 650);
        const ease = 1 - (1 - k) ** 3;
        let dLon = target[0] - from[0];
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        return [from[0] + dLon * ease, from[1] + (target[1] - from[1]) * ease];
      });
      if (!reduce && t - (start as number) < 650) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // Only refocus when the location changes from outside the globe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = size.width * ratio;
    canvas.height = size.height * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    const path = geoPath(projection, ctx);
    const [cx, cy] = [size.width / 2, size.height / 2];

    // Atmosphere glow and ocean.
    ctx.save();
    ctx.shadowColor = COLORS.glow;
    ctx.shadowBlur = 40;
    ctx.beginPath();
    path({ type: "Sphere" });
    const ocean = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.35, radius * 0.1, cx, cy, radius);
    ocean.addColorStop(0, COLORS.oceanInner);
    ocean.addColorStop(1, COLORS.oceanOuter);
    ctx.fillStyle = ocean;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    path(GRATICULE);
    ctx.strokeStyle = COLORS.graticule;
    ctx.lineWidth = 0.6;
    ctx.stroke();

    for (const f of COUNTRIES) {
      ctx.beginPath();
      path(f as GeoPermissibleObjects);
      ctx.fillStyle = (Number(f.id) || 0) % 3 === 0 ? COLORS.landShade : COLORS.land;
      ctx.fill();
    }
    if (showOutlines) {
      ctx.beginPath();
      path(BORDERS);
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    const box = draft ?? activeBox;
    if (box) {
      ctx.beginPath();
      path(boxRing(box));
      ctx.fillStyle = COLORS.activeFill;
      ctx.fill();
      ctx.setLineDash(draft ? [6, 4] : []);
      ctx.strokeStyle = COLORS.active;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (activeFeature && !draft) {
      ctx.beginPath();
      path(activeFeature as GeoPermissibleObjects);
      ctx.fillStyle = COLORS.activeFill;
      ctx.fill();
      ctx.strokeStyle = COLORS.active;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }

    // Markers on the visible hemisphere.
    for (const m of markers) {
      const p = projection([m.lon, m.lat]);
      if (!p || !isVisible(m, rotation)) continue;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 9, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(7,23,63,0.55)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p[0], p[1], 4.2, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.marker;
      ctx.fill();
    }

    // Sphere rim.
    ctx.beginPath();
    path({ type: "Sphere" });
    ctx.strokeStyle = "rgba(160,205,255,0.5)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }, [projection, size, radius, rotation, showOutlines, activeBox, activeFeature, draft, markers]);

  const toLonLat = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const point: [number, number] = [clientX - rect.left, clientY - rect.top];
      const dx = point[0] - size.width / 2;
      const dy = point[1] - size.height / 2;
      if (dx * dx + dy * dy > radius * radius) return null;
      return (projection.invert?.(point) as [number, number] | null) ?? null;
    },
    [projection, size, radius],
  );

  const markerAt = (clientX: number, clientY: number): GlobeMarker | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    for (const m of markers) {
      const p = projection([m.lon, m.lat]);
      if (p && isVisible(m, rotation) && Math.hypot(p[0] - (clientX - rect.left), p[1] - (clientY - rect.top)) <= 12) return m;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const start = drawing ? toLonLat(e.clientX, e.clientY) : null;
    const [a, b] = [...pointers.current.values()];
    gesture.current = { x: e.clientX, y: e.clientY, rotation, zoom, distance: a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, moved: false, drawStart: start };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!pointers.current.has(e.pointerId) || !g) {
      const m = markerAt(e.clientX, e.clientY);
      const rect = canvasRef.current?.getBoundingClientRect();
      setHover(m && rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top, label: m.label } : null);
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && g.distance > 0) {
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      setZoom(Math.min(6, Math.max(0.8, (g.zoom * d) / g.distance)));
      g.moved = true;
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
    if (drawing && g.drawStart) {
      const end = toLonLat(e.clientX, e.clientY);
      if (end) setDraft(cornersToBBox({ lng: g.drawStart[0], lat: g.drawStart[1] }, { lng: unwrap(g.drawStart[0], end[0]), lat: end[1] }));
      return;
    }
    const k = 0.32 / zoom;
    setRotation([g.rotation[0] - dx * k, Math.max(-85, Math.min(85, g.rotation[1] + dy * k))]);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (!g) return;
    if (drawing && draft) {
      onDrawBox(draft);
      setDraft(null);
      return;
    }
    if (g.moved) return;
    const marker = markerAt(e.clientX, e.clientY);
    if (marker) return onPickMarker(marker);
    const lonlat = toLonLat(e.clientX, e.clientY);
    if (!lonlat || drawing) return;
    const hit = COUNTRIES.find((f) => geoContains(f as GeoPermissibleObjects, lonlat));
    if (hit?.id !== undefined) onPickCountry(String(hit.id).padStart(3, "0"), hit.properties.name);
  };

  // Wheel zoom needs a non-passive listener.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(6, Math.max(0.8, z * (1 - e.deltaY * 0.0012))));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 8 / zoom;
    if (e.key === "ArrowLeft") setRotation(([lon, lat]) => [lon - step, lat]);
    else if (e.key === "ArrowRight") setRotation(([lon, lat]) => [lon + step, lat]);
    else if (e.key === "ArrowUp") setRotation(([lon, lat]) => [lon, Math.min(85, lat + step)]);
    else if (e.key === "ArrowDown") setRotation(([lon, lat]) => [lon, Math.max(-85, lat - step)]);
    else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(6, z * 1.25));
    else if (e.key === "-") setZoom((z) => Math.max(0.8, z / 1.25));
    else return;
    e.preventDefault();
  };

  return (
    <div ref={wrapRef} className="globe-wrap" data-testid="globe">
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height, cursor: drawing ? "crosshair" : "grab", touchAction: "none" }}
        tabIndex={0}
        role="application"
        aria-roledescription="interactive globe"
        aria-label="Interactive globe. Arrow keys rotate, plus and minus zoom. Click a country to select it, or use Draw area to drag a rectangle. The setup column offers the same choices as a list and coordinate fields."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          pointers.current.clear();
          gesture.current = null;
          setDraft(null);
        }}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
      />
      {hover && (
        <span className="globe-chip" style={{ left: hover.x + 12, top: hover.y - 14 }} aria-hidden="true">
          <span className="dot" /> {hover.label}
        </span>
      )}
      <div className="globe-controls">
        <button type="button" className="ws-btn ws-btn-ghost" onClick={() => setZoom((z) => Math.min(6, z * 1.25))} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="ws-btn ws-btn-ghost" onClick={() => setZoom((z) => Math.max(0.8, z / 1.25))} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          className="ws-btn ws-btn-ghost"
          onClick={() => {
            setZoom(1);
            setRotation([20, -10]);
          }}
        >
          Reset view
        </button>
      </div>
    </div>
  );
}

/** True when a marker lies on the hemisphere facing the viewer. */
function isVisible(m: GlobeMarker, rotation: [number, number]): boolean {
  return geoDistance([m.lon, m.lat], rotation) < Math.PI / 2 - 0.05;
}

function unwrap(from: number, to: number): number {
  if (to - from > 180) return to - 360;
  if (from - to > 180) return to + 360;
  return to;
}
