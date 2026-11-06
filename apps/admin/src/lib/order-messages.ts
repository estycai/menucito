import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderMessageTemplateList, OrderMessageTemplatesInput } from "@menucito/shared";
import { api } from "./restaurant";

export const ORDER_MESSAGES_KEY = ["order-messages"] as const;

/** Messages of the local for each status change; loaded when "Ajustes de pedidos" opens. */
export function useOrderMessages(enabled = true) {
  return useQuery({
    queryKey: ORDER_MESSAGES_KEY,
    queryFn: () => api<OrderMessageTemplateList>("/api/order-messages"),
    enabled,
  });
}

export function useSaveOrderMessages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderMessageTemplatesInput) =>
      api<OrderMessageTemplateList>("/api/order-messages", { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: (saved) => {
      queryClient.setQueryData(ORDER_MESSAGES_KEY, saved);
    },
  });
}
