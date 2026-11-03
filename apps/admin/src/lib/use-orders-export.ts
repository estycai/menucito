import { useMutation } from "@tanstack/react-query";
import { downloadOrdersCsv, isExportTooLargeError, type OrderFilters } from "./orders";
import { ORDERS_UI_MESSAGES } from "./orders-messages";

/** Copy for a failed export: only the "too many orders" code gets its own; network or other errors are generic. */
export function exportErrorMessage(err: unknown): string {
  return isExportTooLargeError(err) ? ORDERS_UI_MESSAGES.exportTooLarge : ORDERS_UI_MESSAGES.exportFailed;
}

/**
 * CSV export of the history with `filters`. A mutation (not a bare fetch) so a 401 goes through the
 * global session handling of the query client.
 */
export function useOrdersExport(filters: OrderFilters) {
  const mutation = useMutation({ mutationFn: () => downloadOrdersCsv(filters) });
  return {
    exportCsv: () => mutation.mutate(),
    isExporting: mutation.isPending,
    error: mutation.isError ? exportErrorMessage(mutation.error) : null,
  };
}
