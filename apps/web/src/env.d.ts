interface ImportMetaEnv {
  /** Base URL of the API (server fetch and absolute image URLs). Default `http://127.0.0.1:8787`. */
  readonly PUBLIC_API_URL?: string;
  /** Browser key of the Maps JavaScript API, for the address map of stores in `zones` mode. */
  readonly PUBLIC_GOOGLE_MAPS_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
