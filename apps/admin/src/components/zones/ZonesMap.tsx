import { useEffect, useRef } from "react";
import type { LatLng, LatLngTuple } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { GOOGLE_MAPS_KEY } from "@/lib/config";
import { useMapsLibraries, type MapsLibraries } from "@/lib/google-maps";
import { circlePath, type ZoneDraft } from "@/lib/zone-form";

/** Where the map starts when the store has no location yet (Obelisco, Buenos Aires). */
const FALLBACK_CENTER: LatLng = { lat: -34.6037, lng: -58.3816 };

export type GeometryPatch = Partial<Pick<ZoneDraft, "radiusM" | "innerRadiusM" | "polygon">>;

interface ZonesMapProps {
  /** The store; radius and ring zones are drawn around it. */
  center: LatLng | null;
  /** Zones to draw (hidden ones already left out), in list order. */
  zones: readonly ZoneDraft[];
  /** The open zone: the only one with handles to edit. */
  selectedKey: string | null;
  /** Zone that map clicks add points to, or `null`. */
  drawingKey: string | null;
  onGeometryChange: (key: string, patch: GeometryPatch) => void;
  onAddPoint: (key: string, point: LatLngTuple) => void;
}

/** Shows the key-missing notice, or the map once the Maps script loads (only when this renders). */
export function ZonesMap(props: ZonesMapProps) {
  if (!GOOGLE_MAPS_KEY) {
    return <Notice tone="warning">El mapa no está disponible: falta configurar la clave de Google Maps.</Notice>;
  }
  return <LoadedMap {...props} />;
}

function LoadedMap(props: ZonesMapProps) {
  const { libs, failed } = useMapsLibraries();
  if (failed) return <Notice tone="error">No pudimos cargar el mapa. Revisá tu conexión y recargá la página.</Notice>;
  if (!libs) {
    return <div className="h-[360px] animate-pulse rounded-xl bg-tab lg:h-[560px]" aria-label="Cargando mapa" role="status" />;
  }
  return <MapCanvas libs={libs} {...props} />;
}

/** Map overlays of one zone, and the listeners to remove with them. */
interface ZoneOverlays {
  shape: ZoneDraft["shape"];
  circles: google.maps.Circle[];
  polygon: google.maps.Polygon | null;
  listeners: google.maps.MapsEventListener[];
  /** Listeners on the polygon path (rebound whenever the path object is replaced). */
  pathListeners: google.maps.MapsEventListener[];
}

const toLatLng = ([lat, lng]: LatLngTuple): google.maps.LatLngLiteral => ({ lat, lng });
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

function readPath(polygon: google.maps.Polygon): LatLngTuple[] {
  return polygon
    .getPath()
    .getArray()
    .map((point) => [round6(point.lat()), round6(point.lng())] as LatLngTuple);
}

const samePath = (a: readonly LatLngTuple[], b: readonly LatLngTuple[]) =>
  a.length === b.length && a.every(([lat, lng], i) => Math.abs(lat - (b[i]?.[0] ?? NaN)) < 1e-6 && Math.abs(lng - (b[i]?.[1] ?? NaN)) < 1e-6);

/**
 * The Google map. It is driven imperatively: every render syncs the overlays with `zones` (creating,
 * updating or removing them), and handle drags report back through `onGeometryChange`. Programmatic
 * updates run with `syncing` on so their change events are not reported back as edits.
 */
function MapCanvas({ libs, center, zones, selectedKey, drawingKey, onGeometryChange, onAddPoint }: ZonesMapProps & { libs: MapsLibraries }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const overlaysRef = useRef(new Map<string, ZoneOverlays>());
  const syncing = useRef(false);
  // Latest callbacks and drawing target, read by listeners bound once.
  const handlers = useRef({ onGeometryChange, onAddPoint, drawingKey, center });
  useEffect(() => {
    handlers.current = { onGeometryChange, onAddPoint, drawingKey, center };
  });

  // The map itself, once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = new libs.maps.Map(containerRef.current, {
      center: center ?? FALLBACK_CENTER,
      zoom: center ? 13 : 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: "cooperative",
    });
    // `center` only matters on creation; later moves are handled by the marker effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libs]);

  // The store marker; the map follows the store when it moves.
  const lat = center?.lat;
  const lng = center?.lng;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || lat === undefined || lng === undefined) return;
    const position = { lat, lng };
    if (!markerRef.current) {
      markerRef.current = new libs.marker.Marker({ map, position, title: "Tu local", zIndex: 1000 });
    } else {
      markerRef.current.setPosition(position);
    }
    map.panTo(position);
  }, [libs, lat, lng]);

  // Clicks on the map add points while drawing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawingKey) return;
    map.setOptions({ draggableCursor: "crosshair" });
    const listener = map.addListener("click", (event: google.maps.MapMouseEvent) => {
      if (event.latLng) handlers.current.onAddPoint(drawingKey, [round6(event.latLng.lat()), round6(event.latLng.lng())]);
    });
    return () => {
      listener.remove();
      map.setOptions({ draggableCursor: null });
    };
  }, [drawingKey]);

  // Overlays <- zones.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const overlays = overlaysRef.current;
    const report = (key: string, patch: GeometryPatch) => {
      if (!syncing.current) handlers.current.onGeometryChange(key, patch);
    };

    syncing.current = true;
    try {
      const wanted = new Set<string>();
      zones.forEach((zone, index) => {
        // Radius and ring zones are measured from the store; without it they cannot be drawn.
        if (zone.shape !== "polygon" && !center) return;
        wanted.add(zone.key);

        let current = overlays.get(zone.key);
        if (current && current.shape !== zone.shape) {
          removeOverlays(current);
          current = undefined;
        }
        if (!current) {
          current = createOverlays(libs, map, zone, report, handlers);
          overlays.set(zone.key, current);
        }
        updateOverlays(current, zone, center, {
          selected: zone.key === selectedKey,
          // Earlier zones win when they overlap, so they are drawn on top.
          zIndex: 100 - index,
          report,
          handlers,
        });
      });

      for (const [key, stale] of overlays) {
        if (wanted.has(key)) continue;
        removeOverlays(stale);
        overlays.delete(key);
      }
    } finally {
      syncing.current = false;
    }
  });

  // Remove everything when the map goes away.
  useEffect(() => {
    const overlays = overlaysRef.current;
    return () => {
      for (const zone of overlays.values()) removeOverlays(zone);
      overlays.clear();
      markerRef.current?.setMap(null);
    };
  }, []);

  return <div ref={containerRef} className="h-[360px] w-full overflow-hidden rounded-xl lg:h-[560px]" aria-label="Mapa de zonas de entrega" role="region" />;
}

type Report = (key: string, patch: GeometryPatch) => void;
type Handlers = React.RefObject<{
  drawingKey: string | null;
  center: LatLng | null;
  onAddPoint: (key: string, point: LatLngTuple) => void;
}>;

/** Keeps `circle` on the store: an editable circle also offers a center handle, which is undone. */
function pinToStore(circle: google.maps.Circle, handlers: Handlers) {
  return circle.addListener("center_changed", () => {
    const store = handlers.current.center;
    const c = circle.getCenter();
    if (store && c && (c.lat() !== store.lat || c.lng() !== store.lng)) circle.setCenter(store);
  });
}

function createOverlays(libs: MapsLibraries, map: google.maps.Map, zone: ZoneDraft, report: Report, handlers: Handlers): ZoneOverlays {
  const key = zone.key;
  const overlays: ZoneOverlays = { shape: zone.shape, circles: [], polygon: null, listeners: [], pathListeners: [] };

  if (zone.shape === "polygon") {
    const polygon = new libs.maps.Polygon({ map, strokeWeight: 2, fillOpacity: 0.18 });
    overlays.polygon = polygon;
    overlays.listeners.push(
      polygon.addListener("dragend", () => report(key, { polygon: readPath(polygon) })),
      // Right click on a vertex removes it.
      polygon.addListener("contextmenu", (event: google.maps.PolyMouseEvent) => {
        if (event.vertex != null) polygon.getPath().removeAt(event.vertex);
      }),
      // Clicks inside the polygon being drawn add points too (they do not reach the map).
      polygon.addListener("click", (event: google.maps.PolyMouseEvent) => {
        if (handlers.current.drawingKey === key && event.latLng && event.vertex == null && event.edge == null) {
          handlers.current.onAddPoint(key, [round6(event.latLng.lat()), round6(event.latLng.lng())]);
        }
      }),
    );
    return overlays;
  }

  // Radius: one circle. Ring: the outer and inner circles carry the handles (no fill) and a
  // polygon with a hole paints the band between them.
  const outer = new libs.maps.Circle({ map, strokeWeight: 2, fillOpacity: zone.shape === "radius" ? 0.18 : 0 });
  overlays.circles.push(outer);
  overlays.listeners.push(
    outer.addListener("radius_changed", () => report(key, { radiusM: Math.round(outer.getRadius()) })),
    pinToStore(outer, handlers),
  );

  if (zone.shape === "ring") {
    const inner = new libs.maps.Circle({ map, strokeWeight: 1.5, fillOpacity: 0 });
    const band = new libs.maps.Polygon({ map, strokeWeight: 0, fillOpacity: 0.18, clickable: false });
    overlays.circles.push(inner);
    overlays.polygon = band;
    overlays.listeners.push(
      inner.addListener("radius_changed", () => report(key, { innerRadiusM: Math.round(inner.getRadius()) })),
      pinToStore(inner, handlers),
    );
  }
  return overlays;
}

function updateOverlays(
  overlays: ZoneOverlays,
  zone: ZoneDraft,
  center: LatLng | null,
  { selected, zIndex, report, handlers }: { selected: boolean; zIndex: number; report: Report; handlers: Handlers },
) {
  const style = { strokeColor: zone.color, fillColor: zone.color, strokeOpacity: zone.active ? 0.9 : 0.4, zIndex };

  if (zone.shape === "polygon" && overlays.polygon) {
    const polygon = overlays.polygon;
    const drawing = handlers.current.drawingKey === zone.key;
    polygon.setOptions({ ...style, editable: selected, draggable: selected && !drawing, clickable: selected });
    if (!samePath(readPath(polygon), zone.polygon)) {
      polygon.setPath(zone.polygon.map(toLatLng));
      // `setPath` replaces the path object, so its listeners are bound again.
      for (const listener of overlays.pathListeners) listener.remove();
      const path = polygon.getPath();
      const onPathEdit = () => report(zone.key, { polygon: readPath(polygon) });
      overlays.pathListeners = ["set_at", "insert_at", "remove_at"].map((event) => path.addListener(event, onPathEdit));
    }
    return;
  }

  if (!center) return;
  const [outer, inner] = overlays.circles;
  // Circles always sit on the store (see `pinToStore`).
  for (const circle of overlays.circles) {
    circle.setOptions({ ...style, editable: selected, clickable: selected });
    const c = circle.getCenter();
    if (!c || c.lat() !== center.lat || c.lng() !== center.lng) circle.setCenter(center);
  }
  if (outer && Math.abs(outer.getRadius() - zone.radiusM) >= 1) outer.setRadius(zone.radiusM);
  if (zone.shape === "ring" && inner) {
    if (Math.abs(inner.getRadius() - zone.innerRadiusM) >= 1) inner.setRadius(zone.innerRadiusM);
    overlays.polygon?.setOptions({ ...style, strokeWeight: 0, clickable: false, zIndex: zIndex - 1 });
    overlays.polygon?.setPaths([circlePath(center, zone.radiusM, true), circlePath(center, Math.max(1, zone.innerRadiusM), false)]);
  }
}

function removeOverlays(overlays: ZoneOverlays) {
  for (const listener of [...overlays.listeners, ...overlays.pathListeners]) listener.remove();
  for (const circle of overlays.circles) circle.setMap(null);
  overlays.polygon?.setMap(null);
}
