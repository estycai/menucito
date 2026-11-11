import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ADDRESS_LABEL_TEXT,
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_LABELS,
  WHATSAPP_NOTIFICATION_STATUS_LABELS,
  describeOrderOptions,
  formatArs,
  formatLocalDateTime,
  nextStatus,
  type OrderDeliveryLocation,
  type OrderDetail,
  type OrderStatus,
  type PaymentStatus,
  type WhatsappNotification,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { QueryError } from "@/components/QueryError";
import { cashErrorMessage, useCashCurrent, useSettleOrders, useUnsettleOrder } from "@/lib/cash";
import { CourierPickerDialog } from "@/components/orders/CourierPickerDialog";
import { OrderPaymentDialog } from "@/components/orders/OrderPaymentDialog";
import { OrderSourceBadge } from "@/components/orders/OrderSourceBadge";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { PaymentStatusBadge } from "@/components/orders/PaymentStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/lib/access";
import { courierName } from "@/lib/couriers";
import {
  googleMapsSearchUrl,
  isInvalidTransitionError,
  useChangeOrderPayment,
  useChangeOrderStatus,
  useOrder,
} from "@/lib/orders";
import { ORDERS_UI_MESSAGES } from "@/lib/orders-messages";
import { useMyRestaurant } from "@/lib/restaurant";
import {
  ORDER_NOTIFICATIONS_KEY,
  askManualSent,
  manualNoticeUrlFor,
  markCurrentNoticeManual,
  navigateWhatsappWindow,
  openManualNotice,
  reserveWhatsappWindow,
  useMarkNotificationManual,
  useOrderNotifications,
  useRetryNotification,
  useWhatsappNoticeConfig,
} from "@/lib/whatsapp";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { useBackdropClose } from "@/lib/backdrop-close";
import { orderCashNote } from "@/lib/order-cash-note";

/** Modal with the full order and its actions: next status, payment toggle and cancel. */
export function OrderDetailDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const { data: order, isLoading, isError, isRefetching, refetch } = useOrder(orderId);
  const queryClient = useQueryClient();
  const { data: restaurant } = useMyRestaurant();
  const { can } = useAccess();
  const canChangeStatus = can("orders.status");
  const canChangePayment = can("orders.payment");
  const canAssign = can("orders.assign");
  const canSettle = can("cash.settle");
  const statusMutation = useChangeOrderStatus();
  const paymentMutation = useChangeOrderPayment();
  const cash = useCashCurrent(canSettle);
  const settleMutation = useSettleOrders();
  const unsettleMutation = useUnsettleOrder();
  const noticeConfig = useWhatsappNoticeConfig(canChangeStatus || canAssign);
  const notificationsQuery = useOrderNotifications(orderId, can("orders.view"));
  const retryMutation = useRetryNotification(orderId);
  const manualMutation = useMarkNotificationManual(orderId);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showCourierPicker, setShowCourierPicker] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
  }, []);

  useScrollLock();

  async function handleStatusChange(targetStatus: OrderStatus) {
    if (!order) return;
    setErrorMsg(null);
    // Reserve the hand-off window in the click, before the API call, or the browser blocks it.
    const noticeUrl = manualNoticeUrlFor(
      {
        ...order,
        whatsappOptIn: order.whatsappOptIn ?? false,
        whatsappWindowOpen: order.whatsappWindowOpen ?? false,
      },
      targetStatus,
      noticeConfig.data,
      restaurant?.name ?? "",
    );
    const popup = noticeUrl ? reserveWhatsappWindow() : null;
    try {
      await statusMutation.mutateAsync({ id: order.id, status: targetStatus });
      if (noticeUrl && navigateWhatsappWindow(popup, noticeUrl)) {
        askManualSent(() => {
          void markCurrentNoticeManual(order.id, targetStatus).finally(() => {
            void queryClient.invalidateQueries({ queryKey: ["orders"] });
            void queryClient.invalidateQueries({ queryKey: ORDER_NOTIFICATIONS_KEY(order.id) });
          });
        });
      } else {
        popup?.close();
      }
      setShowCancelConfirm(false);
    } catch (err: unknown) {
      popup?.close();
      if (isInvalidTransitionError(err)) {
        refetch();
        setErrorMsg(ORDERS_UI_MESSAGES.orderChanged);
      } else {
        setErrorMsg(ORDERS_UI_MESSAGES.updateFailed);
      }
    }
  }

  async function handlePaymentToggle() {
    if (!order) return;
    setErrorMsg(null);
    const nextPayment: PaymentStatus = order.paymentStatus === "pending" ? "paid" : "pending";
    try {
      await paymentMutation.mutateAsync({ id: order.id, paymentStatus: nextPayment });
    } catch (err) {
      setErrorMsg(cashErrorMessage(err));
    }
  }

  async function handleSettlement() {
    if (!order) return;
    setErrorMsg(null);
    try {
      if (order.settledAt !== null) await unsettleMutation.mutateAsync(order.id);
      else await settleMutation.mutateAsync({ orderIds: [order.id] });
    } catch (err) {
      setErrorMsg(cashErrorMessage(err));
    }
  }

  const isPendingAction =
    statusMutation.isPending || paymentMutation.isPending || settleMutation.isPending || unsettleMutation.isPending;
  const loadFailed = isError && !order;
  // The next step depends on the fulfillment: only a delivery order is "Enviado" (spec 11b).
  const next = order ? nextStatus(order.status, order.fulfillment) : null;

  const backdropClose = useBackdropClose(onClose);
  return (
    <>
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      {...backdropClose}
      className="fixed inset-0 m-auto h-fit max-h-[90vh] w-full max-w-[550px] overflow-y-auto rounded-2xl border border-line bg-white p-5 text-ink shadow-2xl backdrop:bg-black/40 open:block sm:p-6"
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
          <div>
            <h2 id={titleId} className="m-0 font-display text-xl font-extrabold">
              {order ? `Pedido #${order.number}` : loadFailed ? "Pedido" : "Cargando…"}
            </h2>
            {order && <span className="text-xs text-muted">{formatLocalDateTime(order.createdAt)}</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-line text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
          >
            ✕
          </button>
        </div>

        {errorMsg && <Notice tone="error">{errorMsg}</Notice>}

        {loadFailed ? (
          <QueryError
            message={ORDERS_UI_MESSAGES.detailLoadFailed}
            onRetry={() => void refetch()}
            retrying={isRefetching}
          />
        ) : isLoading || !order ? (
          <div className="py-8 text-center text-muted">Cargando detalles del pedido…</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <OrderStatusBadge status={order.status} size="md" />
              <PaymentStatusBadge status={order.paymentStatus} size="md" />
              <OrderSourceBadge source={order.source} />
              <Badge tone="subtle" size="md">
                {FULFILLMENT_LABELS[order.fulfillment]} · {PAYMENT_LABELS[order.paymentMethod]}
              </Badge>
            </div>

            {orderCashNote(order) && <p className="m-0 text-xs text-muted">{orderCashNote(order)}</p>}

            <OrderCustomer order={order} />
            {order.notes && (
              <div className="flex flex-col gap-1 rounded-xl border border-line bg-bg/50 p-3.5 text-sm">
                <span className="text-xs font-bold text-muted">Comentario</span>
                <span className="whitespace-pre-wrap text-ink">{order.notes}</span>
              </div>
            )}
            <OrderItems order={order} />
            <OrderTotals order={order} />

            {notificationsQuery.data && notificationsQuery.data.notifications.length > 0 && (
              <OrderWhatsappNotice
                order={order}
                notifications={notificationsQuery.data.notifications}
                retrying={retryMutation.isPending}
                markingManual={manualMutation.isPending}
                onRetry={(notificationId) =>
                  retryMutation.mutate(notificationId, {
                    onError: () => setErrorMsg(ORDERS_UI_MESSAGES.updateFailed),
                  })
                }
                onManual={(notification) =>
                  openManualNotice(order.customerPhone, notification.body, () => manualMutation.mutate(notification.id))
                }
              />
            )}

            {(canChangeStatus || canChangePayment || canAssign) && (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              {canChangeStatus && next && next !== "sent" && !showCancelConfirm && (
                <Button
                  type="button"
                  disabled={isPendingAction}
                  onClick={() => handleStatusChange(next)}
                  className="min-h-11 w-full text-sm font-bold"
                >
                  Pasar a {ORDER_STATUS_LABELS[next]}
                </Button>
              )}

              {/* "Enviados" is only reached by assigning a courier (change 13, decision 5, scenario 41). */}
              {canAssign && next === "sent" && !showCancelConfirm && (
                <Button
                  type="button"
                  disabled={isPendingAction}
                  onClick={() => setShowCourierPicker(true)}
                  className="min-h-11 w-full text-sm font-bold"
                >
                  Pasar a Enviado
                </Button>
              )}

              {canAssign && order.status === "sent" && !showCancelConfirm && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPendingAction}
                  onClick={() => setShowCourierPicker(true)}
                  className="min-h-11 w-full text-sm font-bold"
                >
                  Cambiar repartidor
                </Button>
              )}

              {canSettle &&
                order.fulfillment === "delivery" &&
                (order.paymentMethod === "cash" || order.paymentMethod === "split") &&
                order.status === "delivered" &&
                !showCancelConfirm &&
                (order.settledAt !== null || cash.data?.session ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isPendingAction}
                    onClick={() => void handleSettlement()}
                    className="min-h-11 w-full text-sm font-bold"
                  >
                    {order.settledAt !== null ? "Deshacer ingreso" : "Ingresar a la caja"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled
                    className="min-h-11 w-full text-sm font-bold"
                  >
                    Abrí la caja primero
                  </Button>
                ))}

              {canChangePayment && !showCancelConfirm && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPendingAction}
                  onClick={handlePaymentToggle}
                  className="min-h-11 w-full text-sm font-bold"
                >
                  {order.paymentStatus === "pending" ? "Marcar como pagado" : "Marcar como pendiente de pago"}
                </Button>
              )}

              {canChangePayment &&
                order.paymentStatus !== "paid" &&
                order.status !== "cancelled" &&
                order.status !== "delivered" &&
                !showCancelConfirm && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isPendingAction}
                    onClick={() => setShowPaymentDialog(true)}
                    className="min-h-11 w-full text-sm font-bold"
                  >
                    Cambiar medio de pago
                  </Button>
                )}

              {canChangeStatus &&
                order.status !== "delivered" &&
                order.status !== "cancelled" &&
                (showCancelConfirm ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
                    <p className="m-0 text-center text-sm font-bold text-danger">
                      ¿Seguro que querés cancelar este pedido?
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isPendingAction}
                        onClick={() => setShowCancelConfirm(false)}
                        className="min-h-11 flex-1 text-sm font-bold"
                      >
                        Volver
                      </Button>
                      <Button
                        type="button"
                        disabled={isPendingAction}
                        onClick={() => handleStatusChange("cancelled")}
                        className="min-h-11 flex-1 bg-danger text-sm font-bold text-white hover:bg-danger/90"
                      >
                        Sí, cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isPendingAction}
                    onClick={() => setShowCancelConfirm(true)}
                    className="min-h-11 w-full text-sm text-danger hover:bg-danger/10"
                  >
                    Cancelar pedido
                  </Button>
                ))}
            </div>
            )}
          </>
        )}
      </div>
    </dialog>

    {showCourierPicker && order && (
      <CourierPickerDialog
        order={{
          id: order.id,
          number: order.number,
          customerName: order.customerName,
          totalCents: order.totalCents,
          deliveryAddress: order.deliveryAddress,
        }}
        status={order.status}
        currentCourierId={order.courier?.memberId ?? null}
        noticeUrl={
          order.status === "ready"
            ? manualNoticeUrlFor(
                {
                  ...order,
                  whatsappOptIn: order.whatsappOptIn ?? false,
                  whatsappWindowOpen: order.whatsappWindowOpen ?? false,
                },
                "sent",
                noticeConfig.data,
                restaurant?.name ?? "",
              )
            : null
        }
        onClose={() => setShowCourierPicker(false)}
        onAssigned={() => setShowCourierPicker(false)}
      />
    )}

    {showPaymentDialog && order && (
      <OrderPaymentDialog order={order} onClose={() => setShowPaymentDialog(false)} />
    )}
    </>
  );
}

function notificationTone(status: WhatsappNotification["status"]) {
  if (status === "failed") return "danger" as const;
  if (status === "pending_manual") return "warning" as const;
  if (status === "skipped") return "subtle" as const;
  if (status === "sending") return "info" as const;
  return "success" as const;
}

/** History of the order's WhatsApp notices, with the reason and the two recovery actions. */
function OrderWhatsappNotice({
  order,
  notifications,
  retrying,
  markingManual,
  onRetry,
  onManual,
}: {
  order: OrderDetail;
  notifications: WhatsappNotification[];
  retrying: boolean;
  markingManual: boolean;
  onRetry: (notificationId: string) => void;
  onManual: (notification: WhatsappNotification) => void;
}) {
  const current = notifications.find((notification) => notification.targetStatus === order.status);
  const manualTarget =
    current && (current.status === "failed" || current.status === "pending_manual") ? current : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-muted">Aviso por WhatsApp</span>
        {current?.status === "failed" && <Badge tone="warning">⚠ Aviso no enviado</Badge>}
        {current?.status === "pending_manual" && <Badge tone="warning">Aviso pendiente de enviar</Badge>}
      </div>
      <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
        {notifications.map((notification) => (
          <li key={notification.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="text-ink">{ORDER_STATUS_LABELS[notification.targetStatus]}</span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">{formatLocalDateTime(notification.createdAt)}</span>
              <Badge tone={notificationTone(notification.status)}>
                {WHATSAPP_NOTIFICATION_STATUS_LABELS[notification.status]}
              </Badge>
            </span>
            {notification.status === "failed" && notification.errorMessage && (
              <span className="basis-full text-xs text-danger">{notification.errorMessage}</span>
            )}
          </li>
        ))}
      </ul>

      {manualTarget && (
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          {manualTarget.status === "failed" && (
            <Button
              type="button"
              variant="outline"
              disabled={retrying || markingManual}
              onClick={() => onRetry(manualTarget.id)}
              className="min-h-11 px-4 text-sm font-bold"
            >
              {retrying ? "Reintentando…" : "Reintentar"}
            </Button>
          )}
          <Button
            type="button"
            disabled={retrying || markingManual}
            onClick={() => onManual(manualTarget)}
            className="min-h-11 px-4 text-sm font-bold"
          >
            Enviar a mano
          </Button>
        </div>
      )}
    </div>
  );
}

function OrderCustomer({ order }: { order: OrderDetail }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-bg/50 p-3.5 text-sm">
      <span className="font-bold text-ink">{order.customerName}</span>
      {order.customerPhone ? (
        <a
          href={`https://wa.me/${order.customerPhone}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-link hover:underline"
        >
          +{order.customerPhone} (WhatsApp)
        </a>
      ) : (
        <span className="text-muted">Sin teléfono</span>
      )}
      {order.fulfillment === "delivery" && order.deliveryAddress && (
        <span className="text-muted">Entrega: {order.deliveryAddress}</span>
      )}
      {order.fulfillment === "delivery" && order.deliveryLocation && (
        <OrderDeliveryLocationDetails location={order.deliveryLocation} />
      )}
      {order.courier && <span className="text-muted">Repartidor: {courierName(order.courier)}</span>}
    </div>
  );
}

/** What the diner pinned for a zones delivery: door details, the zone that priced it and the map. */
function OrderDeliveryLocationDetails({ location }: { location: OrderDeliveryLocation }) {
  return (
    <>
      {location.label && <span className="text-muted">Etiqueta: {ADDRESS_LABEL_TEXT[location.label]}</span>}
      {location.unit && <span className="text-muted">Piso/depto: {location.unit}</span>}
      {location.betweenStreets && <span className="text-muted">Entre calles: {location.betweenStreets}</span>}
      {location.zoneName && <span className="text-muted">Zona: {location.zoneName}</span>}
      <a
        href={googleMapsSearchUrl(location)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-link hover:underline"
      >
        Ver en Google Maps
      </a>
    </>
  );
}

function OrderItems({ order }: { order: OrderDetail }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold text-muted">Ítems</span>
      <div className="divide-y divide-line rounded-xl border border-line bg-white">
        {order.items.map((item) => {
          const options = describeOrderOptions(item.options);
          return (
            <div key={item.id} className="flex flex-col p-3 text-sm">
              <div className="flex items-center justify-between font-semibold">
                <span>
                  {item.quantity}x {item.name}
                </span>
                <span>{formatArs(item.unitPriceCents * item.quantity)}</span>
              </div>
              {options.length > 0 && (
                <ul className="m-0 list-none p-0 text-xs text-muted">
                  {options.map((option) => (
                    <li key={option}>{option}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrderTotals({ order }: { order: OrderDetail }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
      <div className="flex justify-between text-muted">
        <span>Subtotal</span>
        <span>{formatArs(order.subtotalCents)}</span>
      </div>
      {order.fulfillment === "delivery" && (
        <div className="flex justify-between text-muted">
          <span>Envío</span>
          <span>{order.shippingCents > 0 ? formatArs(order.shippingCents) : "Gratis"}</span>
        </div>
      )}
      {order.tipCents > 0 && (
        <div className="flex justify-between text-muted">
          <span>Propina</span>
          <span>{formatArs(order.tipCents)}</span>
        </div>
      )}
      {order.paymentMethod === "split" && (
        <>
          <div className="flex justify-between text-muted">
            <span>Efectivo</span>
            <span>{formatArs(order.paymentBreakdown.cashCents)}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span>Transferencia</span>
            <span>{formatArs(order.paymentBreakdown.transferCents)}</span>
          </div>
        </>
      )}
      {order.paymentBreakdown.tenderedCents !== null && (
        <>
          <div className="flex justify-between text-muted">
            <span>Abona con</span>
            <span>{formatArs(order.paymentBreakdown.tenderedCents)}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span>Vuelto</span>
            <span>{formatArs(order.paymentBreakdown.changeCents ?? 0)}</span>
          </div>
        </>
      )}
      <div className="flex justify-between pt-1 text-base font-extrabold text-ink">
        <span>Total</span>
        <span>{formatArs(order.totalCents)}</span>
      </div>
    </div>
  );
}
