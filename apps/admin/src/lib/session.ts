import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { authClient, unwrap } from "./auth-client";
import { RESTAURANT_KEY } from "./restaurant";

export const SESSION_KEY = ["session"] as const;

/** Current session (null when logged out). Cached so route guards and the shell share it. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      const { data, error } = await authClient.getSession();
      if (error) throw new Error("Could not load session");
      return data;
    },
    staleTime: 30_000,
  });
}

/**
 * Forgets the cached session and restaurant. With no session, `RequireAuth` sends every protected
 * route to /login.
 */
export function clearSession(queryClient: QueryClient) {
  queryClient.setQueryData(SESSION_KEY, null);
  queryClient.removeQueries({ queryKey: RESTAURANT_KEY });
}

/** Ends the session, clears the cached session and restaurant, and lands on /login. */
export function useSignOut() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await authClient.signOut()),
    onSuccess: () => {
      clearSession(queryClient);
      navigate("/login", { replace: true });
    },
  });
}
