"use client";

/**
 * World map for drawing and editing a rectangle (client-only, Leaflet).
 * Drawing uses two clicks or taps (opposite corners) so it also works on touch
 * screens; corners can then be dragged. Keyboard users have equivalent
 * coordinate fields and region search next to the map.
 */
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Rectangle, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { BBox } from "@/src/catalog/regions";
import { bboxToCorners, cornersToBBox } from "@/src/lib/geo";

const handleIcon = L.divIcon({ className: "", html: '<div class="corner-handle"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
const drawStyle = { color: "#0042A6", weight: 2, dashArray: "6 4", fillOpacity: 0.08 };
const boxStyle = { color: "#0042A6", weight: 2, fillColor: "#2E96F5", fillOpacity: 0.15 };

/** Leaflet bounds for a box; boxes crossing 180° extend past the dateline. */
function bboxToBounds(bbox: BBox): L.LatLngBoundsExpression {
  return bboxToCorners(bbox);
}

function DrawLayer({ onDone }: { onDone: (bbox: BBox) => void }) {
  const [anchor, setAnchor] = useState<L.LatLng | null>(null);
  const [cursor, setCursor] = useState<L.LatLng | null>(null);
  const map = useMapEvents({
    click(event) {
      if (!anchor) {
        setAnchor(event.latlng);
        return;
      }
      onDone(cornersToBBox(anchor, event.latlng));
    },
    mousemove(event) {
      if (anchor) setCursor(event.latlng);
    },
  });
  useEffect(() => {
    const container = map.getContainer();
    container.style.cursor = "crosshair";
    return () => {
      container.style.cursor = "";
    };
  }, [map]);
  if (!anchor) return null;
  return (
    <>
      <Marker position={anchor} icon={handleIcon} interactive={false} />
      {cursor && <Rectangle bounds={L.latLngBounds(anchor, cursor)} pathOptions={drawStyle} interactive={false} />}
    </>
  );
}

function FitToBox({ bbox, fitKey }: { bbox: BBox | null; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!bbox) return;
    map.fitBounds(bboxToBounds(bbox), { padding: [24, 24], maxZoom: 6 });
    // Refit only when the selection comes from outside the map (fitKey changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

export interface MapSelectorProps {
  bbox: BBox | null;
  drawing: boolean;
  fitKey: string;
  onChange: (bbox: BBox) => void;
}

export default function MapSelector({ bbox, drawing, fitKey, onChange }: MapSelectorProps) {
  const bounds = useMemo(() => (bbox ? bboxToBounds(bbox) : null), [bbox]);
  const eastUnwrapped = bbox ? (bbox.west > bbox.east ? bbox.east + 360 : bbox.east) : 0;

  return (
    <div className="map-frame" data-testid="map">
      <MapContainer
        center={[12, -20]}
        zoom={1}
        minZoom={1}
        maxZoom={10}
        worldCopyJump
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
        aria-label="World map for drawing a study region"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToBox bbox={bbox} fitKey={fitKey} />
        {drawing && <DrawLayer onDone={onChange} />}
        {!drawing && bbox && bounds && (
          <>
            <Rectangle bounds={bounds} pathOptions={boxStyle} />
            <Marker
              position={[bbox.south, bbox.west]}
              icon={handleIcon}
              draggable
              keyboard={false}
              title="Drag to move the south-west corner"
              eventHandlers={{ dragend: (e) => onChange(cornersToBBox((e.target as L.Marker).getLatLng(), { lat: bbox.north, lng: eastUnwrapped })) }}
            />
            <Marker
              position={[bbox.north, eastUnwrapped]}
              icon={handleIcon}
              draggable
              keyboard={false}
              title="Drag to move the north-east corner"
              eventHandlers={{ dragend: (e) => onChange(cornersToBBox({ lat: bbox.south, lng: bbox.west }, (e.target as L.Marker).getLatLng())) }}
            />
          </>
        )}
      </MapContainer>
    </div>
  );
}
