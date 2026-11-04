import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { ORDER_STATUS_LABELS, type LatLng } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { GOOGLE_MAPS_KEY } from "@/lib/config";
import { useMapsLibraries, type MapsLibraries } from "@/lib/google-maps";
import { ORDER_STATUS_MARKER_COLORS, type MappedOrder } from "@/lib/orders-map";

interface OrdersMapProps {
  /** The store; `null` when it has no location saved. */
  store: LatLng | null;
  orders: readonly MappedOrder[];
  onSelectOrder: (id: string) => void;
}

/** The orders map, or a notice when it cannot be shown (no Maps key or no store location). */
export function OrdersMap(props: OrdersMapProps) {
  if (!GOOGLE_MAPS_KEY) {
    return <Notice tone="warning">El mapa no está disponible: falta configurar la clave de Google Maps.</Notice>;
  }
  if (!props.store) {
    return (
      <Notice tone="warning">
        Para ver el mapa, cargá la ubicación de tu local en{" "}
        <Link to="/local/zonas" className="font-bold text-link hover:underline">
          Zonas de entrega
        </Link>
        . Mientras tanto, los pedidos siguen en la lista.
      </Notice>
    );
  }
  return <LoadedMap {...props} store={props.store} />;
}

function LoadedMap(props: OrdersMapProps & { store: LatLng }) {
  const { libs, failed } = useMapsLibraries();
  if (failed) return <Notice tone="error">No pudimos cargar el mapa. Revisá tu conexión y recargá la página.</Notice>;
  if (!libs) {
    return <div className="h-[360px] animate-pulse rounded-xl bg-tab lg:h-[560px]" aria-label="Cargando mapa" role="status" />;
  }
  return <MapCanvas libs={libs} {...props} />;
}

/**
 * The Google map, driven imperatively: every render syncs one marker per order (created, moved,
 * recolored or removed). The view fits the store and the markers whenever the set of orders changes,
 * so a poll that only moves an order between statuses does not reset a pan or zoom.
 */
function MapCanvas({ libs, store, orders, onSelectOrder }: OrdersMapProps & { libs: MapsLibraries; store: LatLng }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const storeMarkerRef = useRef<google.maps.Marker | null>(null);
  const markersRef = useRef(new Map<string, google.maps.Marker>());
  const fittedKeyRef = useRef<string | null>(null);
  // Latest callback, read by marker listeners bound once.
  const onSelectRef = useRef(onSelectOrder);
  useEffect(() => {
    onSelectRef.current = onSelectOrder;
  });

  // The map itself, once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = new libs.maps.Map(containerRef.current, {
      center: store,
      zoom: 14,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: "cooperative",
    });
    // `store` only matters on creation; later moves are handled by the store marker effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libs]);

  // The store marker.
  const { lat, lng } = store;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!storeMarkerRef.current) {
      storeMarkerRef.current = new libs.marker.Marker({ map, position: { lat, lng }, title: "Tu local", zIndex: 1000 });
    } else {
      storeMarkerRef.current.setPosition({ lat, lng });
    }
  }, [libs, lat, lng]);

  // Markers <- orders, then fit the view when the set of orders changed. `SymbolPath` and
  // `LatLngBounds` live in the core library, which is global once `libs` has loaded.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const wanted = new Set<string>();

    for (const order of orders) {
      wanted.add(order.id);
      const position = { lat: order.deliveryLocation.lat, lng: order.deliveryLocation.lng };
      const options: google.maps.MarkerOptions = {
        position,
        title: `#${order.number} · ${order.customerName} · ${ORDER_STATUS_LABELS[order.status]}`,
        label: { text: String(order.number), color: "#ffffff", fontSize: "11px", fontWeight: "700" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 13,
          fillColor: ORDER_STATUS_MARKER_COLORS[order.status],
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      };
      const current = markers.get(order.id);
      if (current) {
        current.setOptions(options);
      } else {
        const marker = new libs.marker.Marker({ map, ...options });
        marker.addListener("click", () => onSelectRef.current(order.id));
        markers.set(order.id, marker);
      }
    }

    for (const [id, stale] of markers) {
      if (wanted.has(id)) continue;
      stale.setMap(null);
      markers.delete(id);
    }

    const key = [...wanted].sort().join(",");
    if (key === fittedKeyRef.current) return;
    fittedKeyRef.current = key;
    if (orders.length === 0) {
      map.setCenter({ lat, lng });
      map.setZoom(14);
      return;
    }
    const bounds = new google.maps.LatLngBounds({ lat, lng });
    for (const order of orders) bounds.extend(order.deliveryLocation);
    map.fitBounds(bounds, 48);
  }, [libs, orders, lat, lng]);

  // Remove everything when the map goes away.
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      for (const marker of markers.values()) marker.setMap(null);
      markers.clear();
      storeMarkerRef.current?.setMap(null);
    };
  }, [libs]);

  return <div ref={containerRef} className="h-[360px] w-full overflow-hidden rounded-xl lg:h-[560px]" aria-label="Mapa de pedidos" role="region" />;
}
