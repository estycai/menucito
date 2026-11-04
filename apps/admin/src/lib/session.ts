import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { authClient, unwrap } from "./auth-client";
import { ORDERS_KEY } from "./orders";
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
 * Forgets the cached session, restaurant and orders (every order list, the board ones included),
 * so the next login never sees the previous account's orders. With no session, `RequireAuth`
 * sends every protected route to /login.
 */
export function clearSession(queryClient: QueryClient) {
  queryClient.setQueryData(SESSION_KEY, null);
  queryClient.removeQueries({ queryKey: RESTAURANT_KEY });
  queryClient.removeQueries({ queryKey: ORDERS_KEY });
}

/** Ends the session, clears the cached session, restaurant and orders, and lands on /login. */
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
