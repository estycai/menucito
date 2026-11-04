/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "preact/hooks";
import type { LatLng } from "@menucito/shared";
import { ADDRESS_SEARCH_MESSAGES } from "../lib/delivery-address";
import { loadMaps } from "../lib/google-maps";

interface AddressMapProps {
  /** Where the map opens: the chosen address, or the store. */
  center: LatLng;
  /** The map stopped moving; `center` is the point under the pin. */
  onIdle: (center: LatLng) => void;
  /** The Maps script could not load (no key, blocked, offline). */
  onError: () => void;
}

const ZOOM = 17;

/**
 * Map with a fixed pin drawn over its center (CSS, not a marker): the diner drags the map until the
 * pin is on the door. Loads the Maps JavaScript API the first time it mounts.
 */
export function AddressMap({ center, onIdle, onError }: AddressMapProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  // The map listens once; the latest callbacks are read through refs.
  const onIdleRef = useRef(onIdle);
  const onErrorRef = useRef(onError);
  onIdleRef.current = onIdle;
  onErrorRef.current = onError;
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let listener: google.maps.MapsEventListener | null = null;
    loadMaps()
      .then(({ Map }) => {
        if (cancelled || !canvasRef.current) return;
        const map = new Map(canvasRef.current, {
          center,
          zoom: ZOOM,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        mapRef.current = map;
        listener = map.addListener("idle", () => {
          const point = map.getCenter();
          if (point) onIdleRef.current({ lat: point.lat(), lng: point.lng() });
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current();
      });
    return () => {
      cancelled = true;
      listener?.remove();
      mapRef.current = null;
    };
    // The map is created once; later centers come from dragging, not from props.
  }, []);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setGeoError(ADDRESS_SEARCH_MESSAGES.geolocationFailed);
      return;
    }
    setLocating(true);
    setGeoError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        mapRef.current?.panTo({ lat: position.coords.latitude, lng: position.coords.longitude });
        mapRef.current?.setZoom(ZOOM);
      },
      () => {
        setLocating(false);
        setGeoError(ADDRESS_SEARCH_MESSAGES.geolocationFailed);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div class="address-map-wrap">
      <div class="address-map">
        <div ref={canvasRef} class="address-map-canvas" aria-label="Mapa para ubicar tu dirección" />
        <span class="address-map-pin" aria-hidden="true" />
        {!ready && <span class="spinner address-map-loading" aria-label="Cargando el mapa" role="status" />}
      </div>
      <div class="address-map-tools">
        <p class="field-help">Arrastrá el mapa para mover el pin</p>
        <button type="button" class="text-button" onClick={locate} disabled={!ready || locating}>
          {locating ? "Buscando…" : "Usar mi ubicación"}
        </button>
      </div>
      {geoError && (
        <p class="field-error" role="alert">
          {geoError}
        </p>
      )}
    </div>
  );
}
