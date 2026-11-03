import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./restaurant";
import { clearSession } from "./session";

/** A 401 from our API: the session expired or was revoked. */
export function isUnauthorizedError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/**
 * App query client. Any query or mutation answered with a 401 clears the cached session, so
 * `RequireAuth` sends the user to /login instead of leaving screens stuck on an error.
 */
export function createQueryClient(): QueryClient {
  const onError = (err: unknown) => {
    if (isUnauthorizedError(err)) clearSession(queryClient);
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return queryClient;
}
