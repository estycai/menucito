import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fillOrderMessage,
  resolveOrderMessage,
  whatsappManualUrl,
  type OrderMessageTargetStatus,
  type OrderStatus,
  type OrderSummary,
  type WhatsappConnectInput,
  type WhatsappIntegration,
  type WhatsappNoticeConfig,
  type WhatsappNotificationList,
} from "@menucito/shared";
import { ORDERS_POLL_MS } from "./orders";
import { api } from "./restaurant";

/**
 * WhatsApp integration and notices (change 17b). The pure helpers below decide the hand-off to
 * WhatsApp Web; the hooks talk to the API.
 */

export const WHATSAPP_KEY = ["integrations", "whatsapp"] as const;
export const WHATSAPP_NOTICE_CONFIG_KEY = ["whatsapp", "notice-config"] as const;
export const ORDER_NOTIFICATIONS_KEY = (orderId: string) => ["order-notifications", orderId] as const;

export function useWhatsappIntegration(enabled = true) {
  return useQuery({
    queryKey: WHATSAPP_KEY,
    queryFn: () => api<WhatsappIntegration>("/api/integrations/whatsapp"),
    enabled,
    staleTime: 30_000,
  });
}

/** Connection, switch and messages: what a status change needs to decide the hand-off. */
export function useWhatsappNoticeConfig(enabled = true) {
  return useQuery({
    queryKey: WHATSAPP_NOTICE_CONFIG_KEY,
    queryFn: () => api<WhatsappNoticeConfig>("/api/orders/whatsapp-config"),
    enabled,
    staleTime: 60_000,
  });
}

export function useConnectWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WhatsappConnectInput) =>
      api<{ connection: WhatsappIntegration["connection"] }>("/api/integrations/whatsapp/connect", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WHATSAPP_KEY });
      void queryClient.invalidateQueries({ queryKey: WHATSAPP_NOTICE_CONFIG_KEY });
    },
  });
}

export function useSetWhatsappAutoSend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (autoSend: boolean) =>
      api<WhatsappIntegration>("/api/integrations/whatsapp", {
        method: "PATCH",
        body: JSON.stringify({ autoSend }),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(WHATSAPP_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: WHATSAPP_NOTICE_CONFIG_KEY });
    },
  });
}

export function useDisconnectWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<WhatsappIntegration>("/api/integrations/whatsapp", { method: "DELETE" }),
    onSuccess: (saved) => {
      queryClient.setQueryData(WHATSAPP_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: WHATSAPP_NOTICE_CONFIG_KEY });
    },
  });
}

export function useOrderNotifications(orderId: string | null, enabled = true) {
  return useQuery({
    queryKey: ORDER_NOTIFICATIONS_KEY(orderId ?? ""),
    queryFn: () => api<WhatsappNotificationList>(`/api/orders/${orderId}/notifications`),
    enabled: Boolean(orderId) && enabled,
    // The notice is decided after the status change answers (`waitUntil`) and Meta's statuses arrive
    // later by webhook, so the open detail keeps polling like the board.
    refetchInterval: ORDERS_POLL_MS,
  });
}

export function useRetryNotification(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      api(`/api/orders/${orderId}/notifications/${notificationId}/retry`, { method: "POST" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ORDER_NOTIFICATIONS_KEY(orderId) });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useMarkNotificationManual(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      api(`/api/orders/${orderId}/notifications/${notificationId}/manual`, { method: "POST" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ORDER_NOTIFICATIONS_KEY(orderId) });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

type NoticeOrder = Pick<
  OrderSummary,
  "id" | "number" | "customerName" | "customerPhone" | "totalCents" | "fulfillment" | "whatsappOptIn" | "whatsappWindowOpen"
>;

/**
 * Whether moving the order to `targetStatus` should open WhatsApp Web: connected, automatic notices
 * on, the customer allowed them, the 24-hour window closed and a message written for the transition.
 */
export function shouldOpenManualNotice(
  order: Pick<OrderSummary, "fulfillment" | "whatsappOptIn" | "whatsappWindowOpen">,
  targetStatus: OrderStatus,
  config: WhatsappNoticeConfig | null | undefined,
): boolean {
  if (!config?.available || !config.connected || !config.autoSend) return false;
  if (!order.whatsappOptIn || order.whatsappWindowOpen) return false;
  return resolveOrderMessage(config.templates, order.fulfillment, targetStatus as OrderMessageTargetStatus) !== null;
}

/** URL of the hand-off, or `null` when the notice is not manual. */
export function manualNoticeUrlFor(
  order: NoticeOrder,
  targetStatus: OrderStatus,
  config: WhatsappNoticeConfig | null | undefined,
  restaurantName: string,
): string | null {
  if (!shouldOpenManualNotice(order, targetStatus, config)) return null;
  const template = resolveOrderMessage(config!.templates, order.fulfillment, targetStatus as OrderMessageTargetStatus);
  if (!template) return null;
  const body = fillOrderMessage(template, {
    customerName: order.customerName,
    number: order.number,
    totalCents: order.totalCents,
    restaurantName,
  });
  return whatsappManualUrl(order.customerPhone, body);
}

/** Reserves a window synchronously, inside the user's gesture, so a blocked popup is detectable. */
export function reserveWhatsappWindow(): Window | null {
  return typeof window === "undefined" ? null : window.open("", "_blank");
}

/** Navigates the reserved window; `false` when the browser blocked it. */
export function navigateWhatsappWindow(popup: Window | null, url: string): boolean {
  if (!popup) return false;
  popup.opener = null;
  popup.location.href = url;
  return true;
}

/** On returning to the tab, asks "¿Lo enviaste?" and runs `onYes`. */
export function askManualSent(onYes: () => void): void {
  if (typeof window === "undefined") return;
  const onFocus = () => {
    window.removeEventListener("focus", onFocus);
    if (window.confirm("¿Lo enviaste?")) onYes();
  };
  window.addEventListener("focus", onFocus);
}

/** "Enviar a mano" from the detail: opens the stored text and asks on return. */
export function openManualNotice(
  phone: string,
  body: string,
  onSent: () => void,
): void {
  if (typeof window === "undefined") return;
  const popup = window.open(whatsappManualUrl(phone, body), "_blank");
  if (!popup) return;
  popup.opener = null;
  askManualSent(onSent);
}

/**
 * The status change created (or left) a `pending_manual` notice: on return, mark the notice of
 * `targetStatus` as sent. Failures are silent; the badge stays and the detail offers the button.
 */
export async function markCurrentNoticeManual(orderId: string, targetStatus: OrderStatus): Promise<void> {
  const list = await api<WhatsappNotificationList>(`/api/orders/${orderId}/notifications`);
  const current = list.notifications.find(
    (notification) =>
      notification.targetStatus === targetStatus &&
      (notification.status === "pending_manual" || notification.status === "failed"),
  );
  if (current) await api(`/api/orders/${orderId}/notifications/${current.id}/manual`, { method: "POST" });
}
