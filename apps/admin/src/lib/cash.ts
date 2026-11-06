import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CashCloseResult,
  CashCurrent,
  CashHistory,
  CashSession,
  CashSessionDetail,
  CloseCashSessionInput,
  CreateCashMovementInput,
  GiveCourierChangeInput,
  OpenCashSessionInput,
  SettleOrdersInput,
  UpdateCashMovementInput,
} from "@menucito/shared";
import { ORDERS_KEY, ordersPollInterval } from "./orders";
import { ApiError, api } from "./restaurant";

export const CASH_KEY = ["cash"] as const;
export const CASH_CURRENT_KEY = ["cash", "current"] as const;
export const CASH_HISTORY_KEY = ["cash", "history"] as const;
export const cashSessionKey = (id: string) => ["cash", "session", id] as const;

export const CASH_UI_MESSAGES = {
  loadFailed: "No pudimos cargar la caja.",
  historyFailed: "No pudimos cargar el historial de arqueos.",
  detailFailed: "No pudimos cargar el arqueo.",
  noOpen: "Abrí la caja primero.",
  alreadyOpen: "Ya hay una caja abierta. Recargá la página.",
  closed: "La caja ya está cerrada.",
  settled: "El pedido ya está ingresado a la caja. Deshacé el ingreso primero.",
  movementLocked: "Ese movimiento no se puede editar ni anular.",
  generic: "No pudimos guardar el cambio. Probá de nuevo.",
} as const;

/** Message of a failed cash action, by API code. */
export function cashErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "NO_OPEN_CASH_SESSION":
        return CASH_UI_MESSAGES.noOpen;
      case "CASH_SESSION_ALREADY_OPEN":
        return CASH_UI_MESSAGES.alreadyOpen;
      case "CASH_SESSION_CLOSED":
        return CASH_UI_MESSAGES.closed;
      case "ORDER_SETTLED":
        return CASH_UI_MESSAGES.settled;
      case "MOVEMENT_LOCKED":
        return CASH_UI_MESSAGES.movementLocked;
      case "VALIDATION_ERROR":
        return error.message;
    }
  }
  return CASH_UI_MESSAGES.generic;
}

/** Whole pesos typed in a money field, in cents: `undefined` empty, `null` invalid. */
export function pesosCents(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed) * 100;
}

/** Cents as the plain whole-peso value of an input: 120000 -> "1200". */
export function centsInput(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "" : String(Math.round(cents / 100));
}

/** Sign and color of a movement in the list: incomes add, everything else subtracts. */
export function movementSign(kind: string): "+" | "−" {
  return kind === "income" || kind === "order_split_income" || kind === "courier_change_back" ? "+" : "−";
}

export function sessionSalesPath(sessionId: string): string {
  const params = new URLSearchParams({ tab: "historial", cashSessionId: sessionId, paymentStatus: "paid" });
  return `/pedidos?${params.toString()}`;
}

export function useCashCurrent(enabled = true) {
  return useQuery({
    ...queryOptions({
      queryKey: CASH_CURRENT_KEY,
      queryFn: () => api<CashCurrent>("/api/cash-sessions/current"),
      refetchInterval: ordersPollInterval,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: true,
    }),
    enabled,
  });
}

export function useCashSession(id: string | null) {
  return useQuery({
    queryKey: cashSessionKey(id ?? ""),
    queryFn: () => api<CashSessionDetail>(`/api/cash-sessions/${id}`),
    enabled: Boolean(id),
  });
}

export function useCashHistory(page: number, limit = 20) {
  return useQuery({
    queryKey: [...CASH_HISTORY_KEY, page, limit],
    queryFn: () => api<CashHistory>(`/api/cash-sessions?page=${page}&limit=${limit}`),
    placeholderData: keepPreviousData,
  });
}

function useInvalidateCash() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: CASH_KEY }),
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY }),
    ]);
}

export function useOpenCash() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: (input: OpenCashSessionInput) =>
      api<CashSession>("/api/cash-sessions", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

export function useCreateCashMovement() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: (input: CreateCashMovementInput) =>
      api<{ ok: true }>("/api/cash-sessions/current/movements", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateCashMovement() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & UpdateCashMovementInput) =>
      api<{ ok: true }>(`/api/cash-sessions/current/movements/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useVoidCashMovement() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: true }>(`/api/cash-sessions/current/movements/${id}/void`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useSettleOrders() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: (input: SettleOrdersInput) =>
      api<{ ok: true }>("/api/cash-sessions/current/settlements", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUnsettleOrder() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: (orderId: string) =>
      api<void>(`/api/cash-sessions/current/settlements/${orderId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useGiveCourierChange() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: (input: GiveCourierChangeInput) =>
      api<{ ok: true }>("/api/cash-sessions/current/courier-change", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useCloseCash() {
  const invalidate = useInvalidateCash();
  return useMutation({
    mutationFn: (input: CloseCashSessionInput) =>
      api<CashCloseResult>("/api/cash-sessions/current/close", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}
