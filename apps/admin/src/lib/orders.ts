import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ACTIVE_ORDER_STATUSES,
  canTransition,
  localDateKey,
  type ApiErrorBody,
  type OrderDetail,
  type OrderStatus,
  type OrderSummary,
  type PaymentStatus,
} from "@menucito/shared";
import { ApiError, api } from "./restaurant";

export const ORDERS_KEY = ["orders"] as const;
export const ORDER_DETAIL_KEY = (id: string) => ["orders", "detail", id] as const;
/** Mutation key of every status change, so the board knows which orders are being saved. */
export const ORDER_STATUS_MUTATION_KEY = ["orders", "status"] as const;

export type DatePreset = "today" | "7d" | "30d" | "custom" | "";

export interface OrderFilters {
  status?: string;
  fulfillment?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  preset?: DatePreset;
  from?: string;
  to?: string;
}

/** A page of `GET /api/orders`. `nextBefore` is the cursor of the next page; it never goes in the URL. */
export interface OrdersPage {
  orders: OrderSummary[];
  nextBefore: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function resolvePresetDates(preset: DatePreset, nowMs = Date.now()): { from?: string; to?: string } {
  const today = localDateKey(nowMs);

  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "7d": {
      const from = localDateKey(nowMs - 6 * MS_PER_DAY);
      return { from, to: today };
    }
    case "30d": {
      const from = localDateKey(nowMs - 29 * MS_PER_DAY);
      return { from, to: today };
    }
    default:
      return {};
  }
}

export function filtersFromSearchParams(params: URLSearchParams): OrderFilters {
  const filters: OrderFilters = {};

  const status = params.get("status");
  if (status) filters.status = status;

  const fulfillment = params.get("fulfillment");
  if (fulfillment) filters.fulfillment = fulfillment;

  const paymentMethod = params.get("paymentMethod");
  if (paymentMethod) filters.paymentMethod = paymentMethod;

  const paymentStatus = params.get("paymentStatus");
  if (paymentStatus) filters.paymentStatus = paymentStatus;

  const preset = params.get("preset") as DatePreset | null;
  if (preset) filters.preset = preset;

  const from = params.get("from");
  if (from) filters.from = from;

  const to = params.get("to");
  if (to) filters.to = to;

  return filters;
}

export function filtersToSearchParams(filters: OrderFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.status) params.set("status", filters.status);
  if (filters.fulfillment) params.set("fulfillment", filters.fulfillment);
  if (filters.paymentMethod) params.set("paymentMethod", filters.paymentMethod);
  if (filters.paymentStatus) params.set("paymentStatus", filters.paymentStatus);
  if (filters.preset) params.set("preset", filters.preset);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);

  return params;
}

/** Query of the list and the export for `filters`; `before` (the page cursor) only for the list. */
export function buildQueryString(filters: OrderFilters, before?: number): string {
  const params = new URLSearchParams();

  if (filters.status) params.set("status", filters.status);
  if (filters.fulfillment) params.set("fulfillment", filters.fulfillment);
  if (filters.paymentMethod) params.set("paymentMethod", filters.paymentMethod);
  if (filters.paymentStatus) params.set("paymentStatus", filters.paymentStatus);

  // If preset is active and not custom, calculate effective dates
  if (filters.preset && filters.preset !== "custom") {
    const dates = resolvePresetDates(filters.preset);
    if (dates.from) params.set("from", dates.from);
    if (dates.to) params.set("to", dates.to);
  } else {
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
  }

  if (before !== undefined) params.set("before", String(before));

  return params.toString();
}

export function ordersPath(filters: OrderFilters, before?: number): string {
  const qs = buildQueryString(filters, before);
  return qs ? `/api/orders?${qs}` : "/api/orders";
}

/** Filters of the "Activos" board; its query is the one the status change updates optimistically. */
export const ACTIVE_ORDERS_FILTERS: OrderFilters = { status: "active" };
export const ACTIVE_ORDERS_KEY = [...ORDERS_KEY, ACTIVE_ORDERS_FILTERS] as const;

/** Drop targets of the board, in reading order: the active columns plus the "Entregado" zone. */
export const BOARD_DROP_STATUSES = [...ACTIVE_ORDER_STATUSES, "delivered"] as const;
export type BoardDropStatus = (typeof BOARD_DROP_STATUSES)[number];

/**
 * Board drop targets an order in `status` can be dropped on: forward only, never its own column
 * (decision "Sin marcha atrás").
 */
export function dropTargetsFor(status: OrderStatus): BoardDropStatus[] {
  return BOARD_DROP_STATUSES.filter((column) => canTransition(status, column));
}

/** Whether dropping an order in `status` on `target` (a droppable id, if any) changes its status. */
export function isValidDrop(status: OrderStatus, target: unknown): target is BoardDropStatus {
  return (BOARD_DROP_STATUSES as readonly unknown[]).includes(target) && canTransition(status, target as BoardDropStatus);
}

/**
 * Drop target next to `current` in reading order (`1` forward, `-1` backward), or `null` past the
 * ends. Used to move a dragged card between columns with the arrow keys.
 */
export function adjacentColumn(current: unknown, step: 1 | -1): BoardDropStatus | null {
  const index = (BOARD_DROP_STATUSES as readonly unknown[]).indexOf(current);
  if (index === -1) return null;
  return BOARD_DROP_STATUSES[index + step] ?? null;
}

/**
 * The active list after `id` moves to `status`: it changes column, or leaves the board once it is
 * delivered or cancelled. Returns the same page when the order is not on it.
 */
export function moveOrder(page: OrdersPage | undefined, id: string, status: OrderStatus): OrdersPage | undefined {
  if (!page || !page.orders.some((order) => order.id === id)) return page;
  const stillActive = (ACTIVE_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
  return {
    ...page,
    orders: stillActive
      ? page.orders.map((order) => (order.id === id ? { ...order, status } : order))
      : page.orders.filter((order) => order.id !== id),
  };
}

function hasErrorCode(err: unknown, code: string): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === code);
}

/** A 409 from the status change: someone else moved the order first. */
export function isInvalidTransitionError(err: unknown): boolean {
  return hasErrorCode(err, "INVALID_TRANSITION");
}

/** A 422 from the export whose body says the range has too many orders (any other error is generic). */
export function isExportTooLargeError(err: unknown): boolean {
  return hasErrorCode(err, "EXPORT_TOO_LARGE");
}

/** Error of a failed export response, carrying the `{error: {code}}` of its JSON body when there is one. */
export async function exportErrorFrom(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  return new ApiError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? res.statusText);
}

export function useOrders(filters: OrderFilters) {
  return useQuery({
    queryKey: [...ORDERS_KEY, filters],
    queryFn: () => api<OrdersPage>(ordersPath(filters)),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
}

/** History with "Cargar más": each page is appended after the ones already loaded (scenario 44). */
export function useOrdersHistory(filters: OrderFilters) {
  return useInfiniteQuery({
    queryKey: [...ORDERS_KEY, "history", filters],
    queryFn: ({ pageParam }) => api<OrdersPage>(ordersPath(filters, pageParam)),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextBefore ?? undefined,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
}

export function useOrder(id: string | null) {
  return useQuery({
    queryKey: ORDER_DETAIL_KEY(id ?? ""),
    queryFn: () => api<OrderDetail>(`/api/orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useChangeOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ORDER_STATUS_MUTATION_KEY,
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      api<OrderDetail>(`/api/orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    // Optimistic move on the board; the previous list comes back if the change fails.
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ACTIVE_ORDERS_KEY, exact: true });
      const previous = queryClient.getQueryData<OrdersPage>(ACTIVE_ORDERS_KEY);
      queryClient.setQueryData<OrdersPage>(ACTIVE_ORDERS_KEY, (page) => moveOrder(page, id, status));
      return { previous };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(ACTIVE_ORDERS_KEY, context.previous);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(ORDER_DETAIL_KEY(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
    },
  });
}

export function useChangeOrderPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, paymentStatus }: { id: string; paymentStatus: PaymentStatus }) =>
      api<OrderDetail>(`/api/orders/${id}/payment`, {
        method: "PATCH",
        body: JSON.stringify({ paymentStatus }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(ORDER_DETAIL_KEY(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
    },
  });
}

export async function downloadOrdersCsv(filters: OrderFilters) {
  const qs = buildQueryString(filters);
  const path = qs ? `/api/orders/export?${qs}` : "/api/orders/export";

  const res = await fetch(path, {
    credentials: "same-origin",
  });

  if (!res.ok) throw await exportErrorFrom(res);

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1]! : `pedidos-${localDateKey(Date.now())}.csv`;

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
