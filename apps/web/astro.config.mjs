import cloudflare from "@astrojs/cloudflare";
import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";

// Pages are prerendered by default; the menu page opts into SSR with `prerender = false`.
export default defineConfig({
  // No sessions (they would add a KV binding) and no image service: menu images are served by the API.
  adapter: cloudflare({ imageService: "passthrough" }),
  // Preact islands (cart, ingredient sheet, order detail); the rest of the site is plain server HTML.
  integrations: [preact()],
  session: false,
  server: { port: 4321 },
});
