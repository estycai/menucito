import { checkSlug, type PublicMenu } from "@menucito/shared";

export const DEFAULT_API_URL = "http://127.0.0.1:8787";

/** How long the API may take before the menu page gives up and answers 503. */
const API_TIMEOUT_MS = 5000;

/** Result of resolving a menu page: the menu, or the reason there is nothing to show. */
export type MenuResult =
  | { status: "ok"; menu: PublicMenu }
  | { status: "not-found" }
  | { status: "unavailable" }
  | { status: "redirect"; slug: string };

/** `apiUrl` without a trailing slash. */
function trimBase(apiUrl: string) {
  return apiUrl.replace(/\/+$/, "");
}

/** Absolute URL of a public media path (`/api/media/...`) served by the API, or `null` when there is none. */
export function assetUrl(apiUrl: string, path: string | null): string | null {
  return path ? `${trimBase(apiUrl)}${path}` : null;
}

/**
 * Decides what to show for the first path segment `slug`:
 * - a slug that can never exist (invalid or reserved) is "not-found" and never reaches the API;
 * - an uppercase variant of a valid slug is a "redirect" to the lowercase one;
 * - otherwise the API is asked: 200 is "ok", 404 is "not-found", anything else (5xx, network, timeout) is "unavailable".
 */
export async function resolveMenu(
  slug: string,
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MenuResult> {
  const lower = slug.toLowerCase();
  if (checkSlug(lower)) return { status: "not-found" };
  if (slug !== lower) return { status: "redirect", slug: lower };

  try {
    const response = await fetchImpl(`${trimBase(apiUrl)}/api/public/menus/${encodeURIComponent(lower)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (response.status === 404) return { status: "not-found" };
    if (!response.ok) return { status: "unavailable" };
    return { status: "ok", menu: (await response.json()) as PublicMenu };
  } catch {
    return { status: "unavailable" };
  }
}
