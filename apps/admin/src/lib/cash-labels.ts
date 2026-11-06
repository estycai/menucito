import { formatArs, type CashMovement } from "@menucito/shared";

/**
 * Method text of a movement row. A split shows both parts ("Efectivo $2.000 + Transferencia $1.000");
 * an automatic income of a split order already names its method in the comment, so it shows none.
 */
export function movementMethodText(movement: Pick<CashMovement, "method" | "cashCents" | "transferCents" | "automatic">): string | null {
  if (movement.automatic) return null;
  if (movement.method === "split") {
    return `Efectivo ${formatArs(movement.cashCents)} + Transferencia ${formatArs(movement.transferCents)}`;
  }
  return movement.method === "cash" ? "Efectivo" : "Transferencia";
}

/** A payment to a courier, named after the courier so the report says who got it. */
export function courierPaymentLabel(payment: Pick<CashMovement, "courier" | "comment">): string {
  const who = payment.courier ? `${payment.courier.firstName} ${payment.courier.lastName}` : "Repartidor";
  return payment.comment ? `${who} · ${payment.comment}` : who;
}
