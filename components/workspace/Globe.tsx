"use client";

/**
 * Interactive orthographic globe, ported from the approved prototype.
 *
 * The Earth is a NASA Blue Marble texture served by this app
 * (/textures/earth-blue-marble-2048.jpg), shaded per pixel with sunlight, a
 * rim light and an atmosphere glow. Country borders, the yellow outline of the
 * active location and drawn rectangles are vector overlays from world-atlas
 * through d3-geo. d3-geo, topojson-client and world-atlas are bundled; nothing
 * loads from a CDN at runtime.
 *
 * Drag to rotate, scroll or pinch to zoom, click a country, or switch to
 * drawing mode and drag a rectangle. Sample places are real buttons over the
 * canvas, the canvas takes arrow keys and +/-, and the setup column offers the
 * same choices as lists and coordinate fields.
 */
import { geoBounds, geoCentroid, geoContains, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
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

const TEXTURE_URL = "/textures/earth-blue-marble-2048.jpg";
const YELLOW = "#EAFE07";
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 8;
const HOME: [number, number] = [-60, 8];
/** Reference radius of the prototype (globe of radius 148 in a 360 px square). */
const RADIUS_FRACTION = 148 / 360;
const rad = Math.PI / 180;

const topo = topology as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const COUNTRIES = (feature(topo, topo.objects.countries) as unknown as GeoJSON.FeatureCollection<GeoJSON.Geometry, { name: string }>).features as CountryFeature[];
const BORDERS = mesh(topo, topo.objects.countries, (a, b) => a !== b);

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

/** Zoom that frames a box of the given angular size (whole-globe view for large areas). */
export function zoomFor(bbox: BBox): number {
  const east = bbox.west > bbox.east ? bbox.east + 360 : bbox.east;
  const lat = (bbox.south + bbox.north) / 2;
  const span = Math.max((east - bbox.west) * Math.cos(lat * rad), bbox.north - bbox.south, 1);
  return Math.min(3.5, Math.max(1, 60 / span));
}

interface Texture {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface View {
  n: number;
  lon: number;
  lat: number;
  zoom: number;
  texture: Texture | null;
}

/**
 * Renders rows [j0, j1) of the shaded sphere into an n×n RGBA buffer. Light,
 * rim and atmosphere follow the prototype; until the texture arrives, a plain
 * ocean with a graticule is drawn.
 */
function renderRows(out: Uint8ClampedArray, j0: number, j1: number, v: View): void {
  const { n, texture } = v;
  const R = n * RADIUS_FRACTION * v.zoom;
  const L = v.lon * rad;
  const B = v.lat * rad;
  const s = Math.sin(B);
  const k = Math.cos(B);
  const tw = texture?.width ?? 1;
  const th = texture?.height ?? 1;
  const td = texture?.data;
  const half = n / 2;
  const glowWidth = n * (24 / 360);
  for (let j = j0; j < j1; j += 1) {
    const y = (half - (j + 0.5)) / R;
    for (let i = 0; i < n; i += 1) {
      const x = (i + 0.5 - half) / R;
      const h = x * x + y * y;
      const d = 4 * (j * n + i);
      if (h > 1) {
        const distance = (Math.sqrt(h) - 1) * R;
        if (distance < glowWidth) {
          out[d] = 24;
          out[d + 1] = 137;
          out[d + 2] = 255;
          out[d + 3] = 175 * Math.exp(-distance / (glowWidth / 4)) * Math.max(0.18, Math.min(1, 0.72 - x * 0.34 + y * 0.22));
        } else out[d + 3] = 0;
        continue;
      }
      const z = Math.sqrt(1 - h);
      const p = Math.asin(Math.max(-1, Math.min(1, y * k + z * s)));
      const l = L + Math.atan2(x, z * k - y * s);
      const sun = Math.max(0, z * 0.79 - x * 0.48 + y * 0.38);
      const light = 0.48 + 0.52 * Math.min(1, sun);
      const rim = (1 - z) ** 3 * Math.max(0.12, Math.min(1, 0.72 - x * 0.34 + y * 0.22));
      let r: number;
      let g: number;
      let b: number;
      if (!td) {
        const grid = Math.abs(Math.sin(p * 6)) < 0.022 || Math.abs(Math.sin(l * 6)) < 0.026 ? 42 : 0;
        r = 22 + grid;
        g = 79 + grid;
        b = 135 + grid;
      } else {
        // Bilinear lookup in the equirectangular image; longitude wraps around.
        const fu = ((((l / (2 * Math.PI) + 0.5) * tw) % tw) + tw) % tw;
        const fv = Math.min(th - 1.001, Math.max(0, (0.5 - p / Math.PI) * th));
        const u = fu - 0.5;
        const vv = Math.max(0, fv - 0.5);
        const u0 = Math.floor(u);
        const v0 = Math.floor(vv);
        const du = u - u0;
        const dv = vv - v0;
        const ua = (u0 + tw) % tw;
        const ub = (u0 + 1) % tw;
        const va = v0 * tw;
        const vb = Math.min(th - 1, v0 + 1) * tw;
        const a00 = 4 * (va + ua);
        const a10 = 4 * (va + ub);
        const a01 = 4 * (vb + ua);
        const a11 = 4 * (vb + ub);
        const w00 = (1 - du) * (1 - dv);
        const w10 = du * (1 - dv);
        const w01 = (1 - du) * dv;
        const w11 = du * dv;
        r = td[a00]! * w00 + td[a10]! * w10 + td[a01]! * w01 + td[a11]! * w11;
        g = td[a00 + 1]! * w00 + td[a10 + 1]! * w10 + td[a01 + 1]! * w01 + td[a11 + 1]! * w11;
        b = td[a00 + 2]! * w00 + td[a10 + 2]! * w10 + td[a01 + 2]! * w01 + td[a11 + 2]! * w11;
      }
      out[d] = r * light + rim * 18;
      out[d + 1] = g * light + rim * 112;
      out[d + 2] = b * light + rim * 235;
      out[d + 3] = 255;
    }
  }
}

function loadTexture(signal: AbortSignal): Promise<Texture> {
  return fetch(TEXTURE_URL, { signal })
    .then((response) => {
      if (!response.ok) throw new Error(`Texture HTTP ${response.status}`);
      return response.blob();
    })
    .then((blob) => createImageBitmap(blob))
    .then((bitmap) => {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
    });
}

/** True when a point lies on the visible hemisphere (with a margin near the limb). */
function facing(lon: number, lat: number, centerLon: number, centerLat: number, margin = 0.12): boolean {
  const a = lat * rad;
  const dl = (lon - centerLon) * rad;
  const c = centerLat * rad;
  return Math.sin(c) * Math.sin(a) + Math.cos(c) * Math.cos(a) * Math.cos(dl) > margin;
}

function unwrap(from: number, to: number): number {
  if (to - from > 180) return to - 360;
  if (from - to > 180) return to + 360;
  return to;
}

export function Globe(props: GlobeProps) {
  const { activeCountryNumeric, activeBox, drawing, showOutlines, markers, focusKey, onPickCountry, onDrawBox, onPickMarker } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(520);
  const [center, setCenter] = useState<[number, number]>(HOME);
  const [zoom, setZoom] = useState(1);
  const [moving, setMoving] = useState(false);
  const [texture, setTexture] = useState<Texture | null>(null);
  const [draft, setDraft] = useState<BBox | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; label: string } | null>(null);
  const [sharp, setSharp] = useState<{ key: string; image: ImageData } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; center: [number, number]; zoom: number; distance: number; moved: boolean; drawStart: [number, number] | null } | null>(null);

  const radius = size * RADIUS_FRACTION * zoom;
  const projection = useMemo(
    () => geoOrthographic().translate([size / 2, size / 2]).scale(radius).rotate([-center[0], -center[1], 0]).clipAngle(90).precision(0.3),
    [size, radius, center],
  );
  const activeFeature = useMemo(() => COUNTRIES.find((f) => activeCountryNumeric !== null && String(f.id).padStart(3, "0") === activeCountryNumeric) ?? null, [activeCountryNumeric]);

  // The texture is a same-origin static file; until it arrives the globe shows a graticule.
  useEffect(() => {
    const controller = new AbortController();
    loadTexture(controller.signal)
      .then(setTexture)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  // A square canvas that fits the container (its width, and its height when the layout gives one).
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 520;
      const height = entry?.contentRect.height ?? 0;
      const side = height > 200 ? Math.min(width, height) : Math.min(width, 560);
      setSize(Math.round(Math.max(260, Math.min(760, side))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Turn and zoom toward a location chosen elsewhere (country list, assistant, coordinates, examples).
  useEffect(() => {
    const target: [number, number] | null = activeFeature ? (geoCentroid(activeFeature as GeoPermissibleObjects) as [number, number]) : activeBox ? boxCenter(activeBox) : null;
    if (!target) return;
    let targetZoom = 1;
    if (activeFeature) {
      const [[w, s], [e, n]] = geoBounds(activeFeature as GeoPermissibleObjects);
      targetZoom = zoomFor({ west: w, south: s, east: e, north: n });
    } else if (activeBox) targetZoom = zoomFor(activeBox);
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let start: number | null = null;
    let fromCenter: [number, number] | null = null;
    let fromZoom: number | null = null;
    const step = (t: number) => {
      if (start === null) start = t;
      const k = reduce ? 1 : Math.min(1, (t - start) / 900);
      const ease = k * k * (3 - 2 * k);
      setCenter((current) => {
        fromCenter ??= current;
        let dLon = target[0] - fromCenter[0];
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        return [fromCenter[0] + dLon * ease, fromCenter[1] + (target[1] - fromCenter[1]) * ease];
      });
      setZoom((current) => {
        fromZoom ??= current;
        return fromZoom + (targetZoom - fromZoom) * ease;
      });
      setMoving(k < 1);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      setMoving(false);
    };
    // Only refocus when the location changes from outside the globe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // Sharp render at rest: device resolution (capped at 900 px), computed in slices so the page stays responsive.
  const viewKey = `${size}|${center[0].toFixed(3)}|${center[1].toFixed(3)}|${zoom.toFixed(4)}|${texture ? texture.width : 0}`;
  useEffect(() => {
    if (moving) return;
    const n = Math.max(360, Math.min(900, Math.round(size * (window.devicePixelRatio || 1))));
    if (n <= 360) return;
    let cancelled = false;
    const image = new ImageData(n, n);
    const view: View = { n, lon: center[0], lat: center[1], zoom, texture };
    let row = 0;
    let timer = 0;
    const run = () => {
      if (cancelled) return;
      const started = performance.now();
      while (row < n && performance.now() - started < 8) {
        const next = Math.min(n, row + 8);
        renderRows(image.data, row, next, view);
        row = next;
      }
      if (row < n) timer = window.setTimeout(run, 0);
      else setSharp({ key: viewKey, image });
    };
    timer = window.setTimeout(run, 40);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [viewKey, moving, size, center, zoom, texture]);

  // Draw: the shaded sphere (sharp when ready, else a fast 360 px render scaled up), then the vector overlays.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const pixels = Math.round(size * ratio);
    if (canvas.width !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixels, pixels);
    const ready = sharp && sharp.key === viewKey ? sharp.image : null;
    const image = ready ?? new ImageData(360, 360);
    if (!ready) renderRows(image.data, 0, 360, { n: 360, lon: center[0], lat: center[1], zoom, texture });
    const offscreen = document.createElement("canvas");
    offscreen.width = image.width;
    offscreen.height = image.height;
    offscreen.getContext("2d")?.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(offscreen, 0, 0, pixels, pixels);

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const path = geoPath(projection, ctx);
    if (showOutlines) {
      ctx.beginPath();
      path(BORDERS);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    const box = draft ?? activeBox;
    if (box) {
      ctx.beginPath();
      path(boxRing(box));
      ctx.fillStyle = "rgba(234,254,7,0.14)";
      ctx.fill();
      ctx.setLineDash(draft ? [6, 4] : []);
      ctx.strokeStyle = YELLOW;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (activeFeature && !draft) {
      ctx.beginPath();
      path(activeFeature as GeoPermissibleObjects);
      ctx.fillStyle = "rgba(234,254,7,0.12)";
      ctx.fill();
      ctx.strokeStyle = YELLOW;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
  }, [projection, size, center, zoom, texture, showOutlines, activeBox, activeFeature, draft, viewKey, sharp]);

  const toLonLat = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const point: [number, number] = [clientX - rect.left, clientY - rect.top];
      const dx = point[0] - size / 2;
      const dy = point[1] - size / 2;
      if (dx * dx + dy * dy > radius * radius) return null;
      return (projection.invert?.(point) as [number, number] | null) ?? null;
    },
    [projection, size, radius],
  );

  const countryAt = (clientX: number, clientY: number): CountryFeature | null => {
    const lonlat = toLonLat(clientX, clientY);
    if (!lonlat) return null;
    return COUNTRIES.find((f) => geoContains(f as GeoPermissibleObjects, lonlat)) ?? null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const start = drawing ? toLonLat(e.clientX, e.clientY) : null;
    const [a, b] = [...pointers.current.values()];
    gesture.current = { x: e.clientX, y: e.clientY, center, zoom, distance: a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, moved: false, drawStart: start };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!pointers.current.has(e.pointerId) || !g) {
      if (e.pointerType !== "mouse" || drawing) {
        setHover(null);
        return;
      }
      const rect = canvasRef.current?.getBoundingClientRect();
      const hit = countryAt(e.clientX, e.clientY);
      setHover(hit && rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top, label: hit.properties.name } : null);
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && g.distance > 0) {
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (g.zoom * d) / g.distance)));
      g.moved = true;
      setMoving(true);
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
    if (!g.moved) return;
    setMoving(true);
    setHover(null);
    const k = 0.32 / zoom;
    setCenter([g.center[0] - dx * k, Math.max(-85, Math.min(85, g.center[1] + dy * k))]);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    gesture.current = null;
    setMoving(false);
    if (!g) return;
    if (drawing && draft) {
      onDrawBox(draft);
      setDraft(null);
      return;
    }
    if (g.moved || drawing) return;
    const hit = countryAt(e.clientX, e.clientY);
    if (hit?.id !== undefined) onPickCountry(String(hit.id).padStart(3, "0"), hit.properties.name);
  };

  // Wheel zoom needs a non-passive listener; the sharp render waits until the wheel settles.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let settle = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setMoving(true);
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * (1 - e.deltaY * 0.0012))));
      window.clearTimeout(settle);
      settle = window.setTimeout(() => setMoving(false), 160);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      window.clearTimeout(settle);
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 8 / zoom;
    if (e.key === "ArrowLeft") setCenter(([lon, lat]) => [lon - step, lat]);
    else if (e.key === "ArrowRight") setCenter(([lon, lat]) => [lon + step, lat]);
    else if (e.key === "ArrowUp") setCenter(([lon, lat]) => [lon, Math.min(85, lat + step)]);
    else if (e.key === "ArrowDown") setCenter(([lon, lat]) => [lon, Math.max(-85, lat - step)]);
    else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(MAX_ZOOM, z * 1.25));
    else if (e.key === "-") setZoom((z) => Math.max(MIN_ZOOM, z / 1.25));
    else return;
    e.preventDefault();
  };

  // Sample-place pins: buttons on the visible hemisphere; a pin that would overlap an earlier one is hidden.
  const pins = useMemo(() => {
    const placed: Array<[number, number]> = [];
    return markers.map((m) => {
      const p = projection([m.lon, m.lat]);
      let visible = Boolean(p) && facing(m.lon, m.lat, center[0], center[1]);
      if (visible && p) {
        if (p[0] < 24 || p[0] > size - 24 || p[1] < 16 || p[1] > size - 16) visible = false;
        else if (placed.some(([x, y]) => Math.abs(x - p[0]) < 90 && Math.abs(y - p[1]) < 30)) visible = false;
        else placed.push([p[0], p[1]]);
      }
      return { marker: m, x: p?.[0] ?? 0, y: p?.[1] ?? 0, visible };
    });
  }, [markers, projection, center, size]);

  return (
    <div ref={wrapRef} className="globe-wrap" data-testid="globe" data-texture={texture ? "loaded" : "pending"}>
      <div className="globe-sphere" style={{ width: size, height: size }}>
        <canvas
          ref={canvasRef}
          style={{ width: size, height: size, cursor: drawing ? "crosshair" : "grab", touchAction: "none" }}
          tabIndex={0}
          role="application"
          aria-roledescription="interactive globe"
          aria-label="Interactive globe. Arrow keys rotate, plus and minus zoom. Click a country to select it, or use Draw a custom area to drag a rectangle. The setup column offers the same choices as a list and coordinate fields."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            pointers.current.clear();
            gesture.current = null;
            setDraft(null);
            setMoving(false);
          }}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKeyDown}
        />
        {pins.map(({ marker, x, y, visible }) => (
          <button key={marker.id} type="button" className="globe-pin" hidden={!visible} style={{ left: x, top: y }} onClick={() => onPickMarker(marker)} aria-label={`Select ${marker.label}`}>
            {marker.label}
          </button>
        ))}
        {hover && (
          <span className="globe-chip" style={{ left: hover.x + 12, top: hover.y - 14 }} aria-hidden="true">
            {hover.label}
          </span>
        )}
      </div>
      <div className="globe-controls">
        <button type="button" className="ws-btn ws-btn-ghost" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.25))} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="ws-btn ws-btn-ghost" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.25))} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          className="ws-btn ws-btn-ghost"
          onClick={() => {
            setZoom(1);
            setCenter(HOME);
          }}
        >
          Reset view
        </button>
      </div>
    </div>
  );
}
