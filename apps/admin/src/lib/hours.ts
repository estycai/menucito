import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HoursList, ReplaceHoursInput } from "@menucito/shared";
import { api } from "./restaurant";

export const STORE_HOURS_KEY = ["restaurant", "hours"] as const;

/** The opening hours of the store: every slot of the week. */
export function useStoreHours() {
  return useQuery({
    queryKey: STORE_HOURS_KEY,
    queryFn: () => api<HoursList>("/api/restaurants/me/hours"),
  });
}

/** Saves the whole week; days without slots are closed. */
export function useSaveStoreHours() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReplaceHoursInput) =>
      api<HoursList>("/api/restaurants/me/hours", { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: (saved) => {
      queryClient.setQueryData(STORE_HOURS_KEY, saved);
    },
  });
}
