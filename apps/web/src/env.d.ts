interface ImportMetaEnv {
  /** Base URL of the API (server fetch and absolute image URLs). Default `http://127.0.0.1:8787`. */
  readonly PUBLIC_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
