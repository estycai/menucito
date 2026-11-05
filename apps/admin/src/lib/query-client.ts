import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError, RESTAURANT_KEY } from "./restaurant";
import { clearSession } from "./session";

/** A 401 from our API: the session expired or was revoked. */
export function isUnauthorizedError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/** 403 codes that mean "what you can do changed": the member's permissions, role or status. */
const ACCESS_ERROR_CODES = new Set(["FORBIDDEN", "MEMBER_INACTIVE", "OWNER_ONLY"]);

/** A 403 about permissions (not a plan limit): the cached `access` may be out of date. */
export function isAccessError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && ACCESS_ERROR_CODES.has(err.code);
}

/**
 * App query client. Any query or mutation answered with a 401 clears the cached session, so
 * `RequireAuth` sends the user to /login instead of leaving screens stuck on an error. A 403 about
 * permissions refreshes `restaurants/me`, so the navigation follows what the owner changed (spec 12).
 */
export function createQueryClient(): QueryClient {
  const onError = (err: unknown) => {
    if (isUnauthorizedError(err)) clearSession(queryClient);
    else if (isAccessError(err)) void queryClient.invalidateQueries({ queryKey: RESTAURANT_KEY });
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return queryClient;
}
