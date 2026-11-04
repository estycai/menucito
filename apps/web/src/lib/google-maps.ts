/// <reference types="google.maps" />

/** Browser key of the Maps JavaScript API (address map). Empty means the map cannot be shown. */
export const GOOGLE_MAPS_KEY: string = import.meta.env.PUBLIC_GOOGLE_MAPS_KEY ?? "";

let optionsSet = false;
let loading: Promise<google.maps.MapsLibrary> | null = null;

/**
 * Loads the Maps JavaScript API once per page, the first time the address map opens (most diners
 * never need it, so even the loader is a separate chunk). A failed load is not cached, so opening
 * the map again retries.
 */
export function loadMaps(): Promise<google.maps.MapsLibrary> {
  if (!GOOGLE_MAPS_KEY) return Promise.reject(new Error("PUBLIC_GOOGLE_MAPS_KEY is not set"));
  if (!loading) {
    loading = import("@googlemaps/js-api-loader")
      .then(({ importLibrary, setOptions }) => {
        if (!optionsSet) {
          // The loader accepts its options only once per page.
          setOptions({ key: GOOGLE_MAPS_KEY, v: "weekly", language: "es", region: "AR" });
          optionsSet = true;
        }
        return importLibrary("maps");
      })
      .catch((error: unknown) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}
