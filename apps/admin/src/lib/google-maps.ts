import { useEffect, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { GOOGLE_MAPS_KEY } from "./config";

export interface MapsLibraries {
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
}

let optionsSet = false;
let loading: Promise<MapsLibraries> | null = null;

/**
 * Loads the Maps JavaScript API once per page (the script is only requested the first time a map is
 * shown). A failed load is not cached, so opening the tab again retries.
 */
export function loadMaps(): Promise<MapsLibraries> {
  if (!optionsSet) {
    // The loader accepts its options only once per page.
    setOptions({ key: GOOGLE_MAPS_KEY, v: "weekly", language: "es", region: "AR" });
    optionsSet = true;
  }
  if (!loading) {
    loading = Promise.all([importLibrary("maps"), importLibrary("marker")])
      .then(([maps, marker]) => ({ maps, marker }))
      .catch((error: unknown) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}

/** Loads the Maps libraries for a mounted map: `libs` once ready, `failed` if the script did not load. */
export function useMapsLibraries(): { libs: MapsLibraries | null; failed: boolean } {
  const [libs, setLibs] = useState<MapsLibraries | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMaps().then(
      (loaded) => !cancelled && setLibs(loaded),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return { libs, failed };
}
