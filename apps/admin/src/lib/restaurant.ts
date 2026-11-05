import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApiErrorBody,
  CoverUploadResult,
  CreateRestaurantInput,
  LogoUploadResult,
  MyRestaurant,
  Restaurant,
  SlugAvailability,
  UpdateAppearanceInput,
} from "@menucito/shared";
import { useSession } from "./session";

/** Public host of the menus. Placeholder until the real domain is bought. */
export const PUBLIC_BASE: string = import.meta.env.VITE_PUBLIC_BASE || "menucito.com";

export const publicMenuUrl = (slug: string) => `${PUBLIC_BASE}/${slug}`;
export const RESTAURANT_KEY = ["restaurant", "me"] as const;
export const SLUG_AVAILABILITY_KEY = ["restaurant", "slug-available"] as const;

/** Error thrown for non-2xx API responses, carrying the `{error: {code}}` code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  // JSON for string bodies; FormData gets its multipart Content-Type (with boundary) from the browser.
  const json = typeof init.body === "string" ? { "Content-Type": "application/json" } : undefined;
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { ...json, ...init.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Query of the logged-in user's restaurant, or `null` when they have not created one yet. */
export function myRestaurantOptions(userId: string | undefined) {
  return queryOptions({
    // Keyed by user so a different login in the same tab never sees a cached restaurant.
    queryKey: [...RESTAURANT_KEY, userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      try {
        return await api<MyRestaurant>("/api/restaurants/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    // The owner can change this member's role or deactivate them at any time: coming back to the tab
    // always asks again, so the navigation follows the current permissions (spec 12, scenario 43).
    refetchOnWindowFocus: "always",
  });
}

/** The logged-in user's restaurant with what they can do in it (`access`), or `null` before onboarding. */
export function useMyRestaurant() {
  const { data: session } = useSession();
  return useQuery(myRestaurantOptions(session?.user.id));
}

/** Query options for the availability of `slug`; also used with `fetchQuery` right before submitting. */
export function slugAvailabilityOptions(slug: string) {
  return queryOptions({
    queryKey: [...SLUG_AVAILABILITY_KEY, slug],
    queryFn: () => api<SlugAvailability>(`/api/restaurants/slug-available?slug=${encodeURIComponent(slug)}`),
    staleTime: 10_000,
  });
}

/** Availability of `slug` (pass an already debounced value). Disabled while `enabled` is false. */
export function useSlugAvailability(slug: string, enabled: boolean) {
  return useQuery({ ...slugAvailabilityOptions(slug), enabled });
}

export function useCreateRestaurant() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  return useMutation({
    mutationFn: (input: CreateRestaurantInput) =>
      api<Restaurant>("/api/restaurants", { method: "POST", body: JSON.stringify(input) }),
    // `POST /api/restaurants` answers a plain restaurant: read `/me` so the cache has `access` too.
    onSuccess: () =>
      queryClient.fetchQuery({ ...myRestaurantOptions(session?.user.id), staleTime: 0 }),
  });
}

/** Invalidates the restaurant query so every screen shows the current logo. */
function useInvalidateRestaurant() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: RESTAURANT_KEY });
}

/** Uploads an already normalized WebP logo (see `normalizeLogo`). */
export function useUploadLogo() {
  const invalidate = useInvalidateRestaurant();
  return useMutation({
    mutationFn: (webp: Blob) => {
      const form = new FormData();
      form.append("file", webp, "logo.webp");
      return api<LogoUploadResult>("/api/restaurants/me/logo", { method: "PUT", body: form });
    },
    onSuccess: invalidate,
  });
}

export function useRemoveLogo() {
  const invalidate = useInvalidateRestaurant();
  return useMutation({
    mutationFn: () => api<void>("/api/restaurants/me/logo", { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

/** Uploads an already normalized WebP cover (see `normalizeCover`). */
export function useUploadCover() {
  const invalidate = useInvalidateRestaurant();
  return useMutation({
    mutationFn: (webp: Blob) => {
      const form = new FormData();
      form.append("file", webp, "cover.webp");
      return api<CoverUploadResult>("/api/restaurants/me/cover", { method: "PUT", body: form });
    },
    onSuccess: invalidate,
  });
}

export function useRemoveCover() {
  const invalidate = useInvalidateRestaurant();
  return useMutation({
    mutationFn: () => api<void>("/api/restaurants/me/cover", { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

/** Saves description and/or colors (only the changed keys). Colors are Pro: the API answers 403 `PLAN_FEATURE` otherwise. */
export function useUpdateAppearance() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  return useMutation({
    mutationFn: (input: UpdateAppearanceInput) =>
      api<Restaurant>("/api/restaurants/me/appearance", { method: "PATCH", body: JSON.stringify(input) }),
    // The answer is a plain restaurant: merge it so the cached `access` is kept.
    onSuccess: (restaurant) => {
      queryClient.setQueryData<MyRestaurant | null>([...RESTAURANT_KEY, session?.user.id], (previous) =>
        previous ? { ...previous, ...restaurant } : previous,
      );
    },
  });
}
