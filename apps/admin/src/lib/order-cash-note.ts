import { formatLocalDateTime, type OrderDetail } from "@menucito/shared";

type CashNoteOrder = Pick<
  OrderDetail,
  | "status"
  | "fulfillment"
  | "paymentMethod"
  | "paymentStatus"
  | "paidAt"
  | "updatedAt"
  | "cashSessionId"
  | "settledAt"
  | "courier"
>;

/**
 * Line under the payment badges of the order detail: where the money of a paid order is. A cash or
 * split delivery is marked paid when delivered, but its cash is still in the courier's pocket until
 * someone uses "Ingresar a la caja" (spec 14b), so it is not "paid without an open cash".
 */
export function orderCashNote(order: CashNoteOrder): string | null {
  if (order.paymentStatus !== "paid") return null;
  const courierCash =
    order.fulfillment === "delivery" && order.paymentMethod !== "transfer" && order.status === "delivered";
  if (courierCash && order.settledAt === null) {
    const who = order.courier ? `lo tiene ${order.courier.firstName}` : "lo tiene el repartidor";
    return `A ingresar a la caja · ${who}`;
  }
  if (order.settledAt !== null) return `Ingresado a la caja el ${formatLocalDateTime(order.settledAt)}`;
  if (order.cashSessionId) return `Cobrado el ${formatLocalDateTime(order.paidAt ?? order.updatedAt)}`;
  return "Cobrado sin caja abierta";
}
