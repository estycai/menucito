import {
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  ACTIVE_ORDER_STATUSES,
  canTransition,
  localDateKey,
  type ApiErrorBody,
  type Fulfillment,
  type LatLng,
  type OrderDateField,
  type OrderDetail,
  type OrderStatus,
  type OrderSummary,
  type PaymentStatus,
  type UpdateOrderPaymentMethodInput,
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
  /** Orders entered into this cash session (the "N ventas" link of Cajas). */
  cashSessionId?: string;
  settled?: boolean;
  preset?: DatePreset;
  from?: string;
  to?: string;
  /** Page size; only the board sets it, the history keeps the API default. */
  limit?: number;
  /** Timestamp the dates filter on; only the board sets it (`created` in the API by default). */
  dateField?: OrderDateField;
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

  const cashSessionId = params.get("cashSessionId");
  if (cashSessionId) filters.cashSessionId = cashSessionId;

  const settled = params.get("settled");
  if (settled === "true" || settled === "false") filters.settled = settled === "true";

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
  if (filters.cashSessionId) params.set("cashSessionId", filters.cashSessionId);
  if (filters.settled !== undefined) params.set("settled", String(filters.settled));
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
  if (filters.cashSessionId) params.set("cashSessionId", filters.cashSessionId);
  if (filters.settled !== undefined) params.set("settled", String(filters.settled));

  // If preset is active and not custom, calculate effective dates
  if (filters.preset && filters.preset !== "custom") {
    const dates = resolvePresetDates(filters.preset);
    if (dates.from) params.set("from", dates.from);
    if (dates.to) params.set("to", dates.to);
  } else {
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
  }

  if (filters.dateField) params.set("dateField", filters.dateField);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
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

/** Most delivered orders the "Entregados" column shows; the rest are in "Historial". */
export const DELIVERED_TODAY_LIMIT = 50;
/**
 * Filters of the "Entregados" column: the orders delivered today, newest first (spec 11b, decision 4).
 * "Delivered today" uses the exact delivery timestamp (`delivered_at`, change 13 scenario 43).
 */
export const DELIVERED_TODAY_FILTERS: OrderFilters = {
  status: "delivered",
  preset: "today",
  dateField: "delivered",
  limit: DELIVERED_TODAY_LIMIT,
};
export const DELIVERED_TODAY_KEY = [...ORDERS_KEY, DELIVERED_TODAY_FILTERS] as const;
/** History filters behind "Ver todos en el historial" of the "Entregados" column. */
export const DELIVERED_TODAY_HISTORY_FILTERS: OrderFilters = { status: "delivered", preset: "today" };

/** Drop targets of the board, in reading order: the active columns plus "Entregados". */
export const BOARD_DROP_STATUSES = [...ACTIVE_ORDER_STATUSES, "delivered"] as const;
export type BoardDropStatus = (typeof BOARD_DROP_STATUSES)[number];

/** What the signed-in member may do with the board (`orders.status` and `orders.assign`). */
export interface BoardPermissions {
  /** `orders.status`: move the order to any column except "Enviados". */
  canChangeStatus?: boolean;
  /** `orders.assign`: assign a courier to a Ready order, which sends it. */
  canAssign?: boolean;
}

const STATUS_BY_DEFAULT: Required<BoardPermissions> = { canChangeStatus: true, canAssign: true };

/**
 * Whether `column` is reachable from `status`: the other columns need `orders.status`; "Enviados" is
 * only reached by assigning a courier to a Ready order (change 13, decision 5), so it needs
 * `orders.assign` and cannot be skipped from New or Preparing.
 */
function canReach(status: OrderStatus, column: BoardDropStatus, permissions: BoardPermissions): boolean {
  const { canChangeStatus, canAssign } = { ...STATUS_BY_DEFAULT, ...permissions };
  if (column === "sent") return canAssign && status === "ready";
  return canChangeStatus;
}

/**
 * Board drop targets an order in `status` can be dropped on: forward only, never its own column
 * (decision "Sin marcha atrás"), "Enviados" only for a Ready delivery order through assignment.
 */
export function dropTargetsFor(
  status: OrderStatus,
  fulfillment: Fulfillment,
  permissions: BoardPermissions = {},
): BoardDropStatus[] {
  return BOARD_DROP_STATUSES.filter(
    (column) => canTransition(status, column, fulfillment) && canReach(status, column, permissions),
  );
}

/** Whether dropping an order in `status` on `target` (a droppable id, if any) changes its status. */
export function isValidDrop(
  status: OrderStatus,
  fulfillment: Fulfillment,
  target: unknown,
  permissions: BoardPermissions = {},
): target is BoardDropStatus {
  return (
    (BOARD_DROP_STATUSES as readonly unknown[]).includes(target) &&
    canTransition(status, target as BoardDropStatus, fulfillment) &&
    canReach(status, target as BoardDropStatus, permissions)
  );
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

/** The two lists of the board: active orders and the ones delivered today. */
export interface BoardPages {
  active: OrdersPage | undefined;
  delivered: OrdersPage | undefined;
}

/** Order of both board lists, as the API returns them: the highest (newest) number first. */
const newestFirst = (a: OrderSummary, b: OrderSummary) => b.number - a.number;

/** `orders` without `order.id`, plus `order` in its newest-first place. */
function withOrder(orders: OrderSummary[], order: OrderSummary): OrderSummary[] {
  return [...orders.filter((o) => o.id !== order.id), order].sort(newestFirst);
}

/**
 * The board after `id` moves to `status`: it changes column, moves to "Entregados" once delivered
 * or leaves the board once cancelled. "Entregados" is not capped here (the refetch trims it), and
 * a list that has not loaded yet starts with the moved order. Returns the same pages when the
 * order is not on the active list.
 */
export function moveOrder(pages: BoardPages, id: string, status: OrderStatus): BoardPages {
  const order = pages.active?.orders.find((o) => o.id === id);
  if (!pages.active || !order) return pages;
  const stillActive = (ACTIVE_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
  const active: OrdersPage = {
    ...pages.active,
    orders: stillActive
      ? pages.active.orders.map((o) => (o.id === id ? { ...o, status } : o))
      : pages.active.orders.filter((o) => o.id !== id),
  };
  if (status !== "delivered") return { active, delivered: pages.delivered };

  const base: OrdersPage = pages.delivered ?? { orders: [], nextBefore: null };
  return { active, delivered: { ...base, orders: withOrder(base.orders, { ...order, status }) } };
}

/**
 * Undoes a failed `moveOrder` for that one order only: `previous` (the order as it was) goes back
 * to the active list and leaves "Entregados". Other orders moved meanwhile keep their new place.
 */
export function revertOrder(pages: BoardPages, previous: OrderSummary): BoardPages {
  return {
    active: pages.active && { ...pages.active, orders: withOrder(pages.active.orders, previous) },
    delivered: pages.delivered && {
      ...pages.delivered,
      orders: pages.delivered.orders.filter((o) => o.id !== previous.id),
    },
  };
}

/**
 * The board after a successful assignment: the order shows its courier and, when it was Ready, moves
 * to Enviados without waiting for the refetch (scenario 39). A sent order only changes its courier.
 */
export function applyAssignment(pages: BoardPages, updated: OrderDetail): BoardPages {
  if (!pages.active) return pages;
  const exists = pages.active.orders.some((order) => order.id === updated.id);
  if (!exists) return pages;
  return {
    ...pages,
    active: {
      ...pages.active,
      orders: pages.active.orders.map((order) =>
        order.id === updated.id ? { ...order, status: updated.status, courier: updated.courier } : order,
      ),
    },
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

/** Google Maps search link of a point (opens the app on phones), for the courier. */
export function googleMapsSearchUrl({ lat, lng }: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Error of a failed export response, carrying the `{error: {code}}` of its JSON body when there is one. */
export async function exportErrorFrom(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  return new ApiError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? res.statusText);
}

/** How often the order lists refresh while the tab is visible: a courier's delivery shows up in seconds. */
export const ORDERS_POLL_MS = 5000;
/** With the tab hidden the lists keep listening, slower, so the new-order toast and board stay current. */
export const ORDERS_BACKGROUND_POLL_MS = 30000;

/** Poll interval for the current tab visibility (no `document` outside the browser counts as visible). */
export function ordersPollInterval(): number {
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  return hidden ? ORDERS_BACKGROUND_POLL_MS : ORDERS_POLL_MS;
}

/** Query of a list of orders; shared by `useOrders` and anything that observes the same list. */
export function ordersQueryOptions(filters: OrderFilters) {
  return queryOptions({
    queryKey: [...ORDERS_KEY, filters],
    queryFn: () => api<OrdersPage>(ordersPath(filters)),
    refetchInterval: ordersPollInterval,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
}

/** `enabled` is false for a member without `orders.view`: the list is then never requested. */
export function useOrders(filters: OrderFilters, enabled = true) {
  return useQuery({ ...ordersQueryOptions(filters), enabled });
}

/** History with "Cargar más": each page is appended after the ones already loaded (scenario 44). */
export function useOrdersHistory(filters: OrderFilters) {
  return useInfiniteQuery({
    queryKey: [...ORDERS_KEY, "history", filters],
    queryFn: ({ pageParam }) => api<OrdersPage>(ordersPath(filters, pageParam)),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextBefore ?? undefined,
    // History reloads every loaded page on each poll, so it keeps the slow pace.
    refetchInterval: ORDERS_BACKGROUND_POLL_MS,
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

function readBoard(queryClient: QueryClient): BoardPages {
  return {
    active: queryClient.getQueryData<OrdersPage>(ACTIVE_ORDERS_KEY),
    delivered: queryClient.getQueryData<OrdersPage>(DELIVERED_TODAY_KEY),
  };
}

/** Writes only the lists that changed, so an untouched (or never loaded) query is left alone. */
function writeBoard(queryClient: QueryClient, current: BoardPages, next: BoardPages) {
  if (next.active !== current.active) queryClient.setQueryData(ACTIVE_ORDERS_KEY, next.active);
  if (next.delivered !== current.delivered) queryClient.setQueryData(DELIVERED_TODAY_KEY, next.delivered);
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
    // Optimistic move on the board. A failure puts back only that order, so another drag that
    // happened meanwhile is not undone with it.
    onMutate: async ({ id, status }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ACTIVE_ORDERS_KEY, exact: true }),
        queryClient.cancelQueries({ queryKey: DELIVERED_TODAY_KEY, exact: true }),
      ]);
      const pages = readBoard(queryClient);
      const previousOrder = pages.active?.orders.find((o) => o.id === id);
      writeBoard(queryClient, pages, moveOrder(pages, id, status));
      return { previousOrder };
    },
    onError: (_err, _variables, context) => {
      if (!context?.previousOrder) return;
      const pages = readBoard(queryClient);
      writeBoard(queryClient, pages, revertOrder(pages, context.previousOrder));
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(ORDER_DETAIL_KEY(updated.id), updated);
    },
    // Both board lists (and the history) reload whatever the outcome.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
    },
  });
}

/**
 * `POST /api/orders/:id/assign`: sends a Ready order or reassigns a sent one (change 13, decisions
 * 5 and 7). The board shows the courier as soon as the API answers, then both lists reload; it is
 * not optimistic because the courier's name only comes in the response.
 */
export function useAssignCourier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, courierMemberId }: { id: string; courierMemberId: string }) =>
      api<OrderDetail>(`/api/orders/${id}/assign`, {
        method: "POST",
        body: JSON.stringify({ courierMemberId }),
      }),
    onMutate: async () => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ACTIVE_ORDERS_KEY, exact: true }),
        queryClient.cancelQueries({ queryKey: DELIVERED_TODAY_KEY, exact: true }),
      ]);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(ORDER_DETAIL_KEY(updated.id), updated);
      const pages = readBoard(queryClient);
      writeBoard(queryClient, pages, applyAssignment(pages, updated));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
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

/** `PATCH /api/orders/:id/payment-method`: changes the method, the split and the tendered amount. */
export function useChangeOrderPaymentMethod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & UpdateOrderPaymentMethodInput) =>
      api<OrderDetail>(`/api/orders/${id}/payment-method`, {
        method: "PATCH",
        body: JSON.stringify(input),
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

export interface LifetimeTotals {
  orders: number;
  customers: number;
}

/** All-time orders (cancelled excluded) and customers for "Resumen". Under `ORDERS_KEY`, so new orders refresh it. */
export function useLifetimeTotals(enabled = true) {
  return useQuery({
    queryKey: [...ORDERS_KEY, "totals"] as const,
    queryFn: () => api<LifetimeTotals>("/api/orders/totals"),
    enabled,
  });
}
