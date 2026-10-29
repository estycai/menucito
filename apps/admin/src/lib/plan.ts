import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChangePlanInput, Restaurant } from "@menucito/shared";
import { CATALOG_KEY } from "./catalog";
import { RESTAURANT_KEY, api } from "./restaurant";

/**
 * Switches the restaurant's plan (free, test-only: the API refuses it unless `ALLOW_PLAN_SWITCH` is on).
 * On success the restaurant and catalog queries are refreshed, so the sidebar, this page and the
 * "Mi menú" usage line show the new plan at once.
 */
export function useChangePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePlanInput) =>
      api<Restaurant>("/api/restaurants/me/plan", { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: RESTAURANT_KEY }),
        queryClient.invalidateQueries({ queryKey: CATALOG_KEY }),
      ]);
    },
  });
}
