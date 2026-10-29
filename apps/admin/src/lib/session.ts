import { useQuery } from "@tanstack/react-query";
import { authClient } from "./auth-client";

export const SESSION_KEY = ["session"] as const;

/** Current session (null when logged out). Cached so route guards and the welcome view share it. */
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
