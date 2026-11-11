import { useEffect, useRef } from "react";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import type { CustomerHeatmapPoint, LatLng } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { useMapsLibraries, type MapsLibraries } from "@/lib/google-maps";

interface HeatmapCanvasProps {
  store: LatLng | null;
  points: readonly CustomerHeatmapPoint[];
}

/**
 * Google map with a deck.gl heatmap of the customers (change 17a). Loaded with `lazy()` only on
 * /clientes/mapa, so deck.gl never weighs on the rest of the panel.
 */
export default function CustomersHeatmapCanvas(props: HeatmapCanvasProps) {
  const { libs, failed } = useMapsLibraries();
  if (failed) return <Notice tone="error">No pudimos cargar el mapa. Revisá tu conexión y recargá la página.</Notice>;
  if (!libs) {
    return <div className="h-[420px] animate-pulse rounded-2xl bg-tab lg:h-[600px]" aria-label="Cargando mapa" role="status" />;
  }
  return <Canvas libs={libs} {...props} />;
}

// Buenos Aires, when there is neither a store location nor any point.
const FALLBACK_CENTER = { lat: -34.6037, lng: -58.3816 };

function Canvas({ libs, store, points }: HeatmapCanvasProps & { libs: MapsLibraries }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const storeMarkerRef = useRef<google.maps.Marker | null>(null);

  // The map and the overlay, once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new libs.maps.Map(containerRef.current, {
      center: store ?? FALLBACK_CENTER,
      zoom: 13,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: "cooperative",
    });
    const overlay = new GoogleMapsOverlay({ interleaved: false, layers: [] });
    overlay.setMap(map);
    mapRef.current = map;
    overlayRef.current = overlay;
    return () => {
      overlay.finalize();
      overlayRef.current = null;
      mapRef.current = null;
    };
    // `store` only matters on creation; the pin effect follows later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libs]);

  // "Tu local" pin.
  const storeLat = store?.lat;
  const storeLng = store?.lng;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (storeLat === undefined || storeLng === undefined) {
      storeMarkerRef.current?.setMap(null);
      storeMarkerRef.current = null;
      return;
    }
    const position = { lat: storeLat, lng: storeLng };
    if (!storeMarkerRef.current) {
      storeMarkerRef.current = new google.maps.Marker({ map, position, title: "Tu local", label: "★", zIndex: 1000 });
    } else {
      storeMarkerRef.current.setPosition(position);
    }
  }, [storeLat, storeLng]);

  // The heat layer and the view: fit the points, or center on the store.
  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) return;
    overlay.setProps({
      layers: [
        new HeatmapLayer<CustomerHeatmapPoint>({
          id: "customers-heat",
          data: points as CustomerHeatmapPoint[],
          getPosition: (point) => [point.lng, point.lat],
          getWeight: (point) => point.weight,
          radiusPixels: 40,
          intensity: 1,
          threshold: 0.05,
        }),
      ],
    });
    if (points.length === 0) {
      if (store) map.setCenter(store);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const point of points) bounds.extend({ lat: point.lat, lng: point.lng });
    if (store) bounds.extend(store);
    map.fitBounds(bounds, 48);
  }, [points, store]);

  return <div ref={containerRef} className="h-[420px] w-full overflow-hidden rounded-2xl border border-line lg:h-[600px]" />;
}
