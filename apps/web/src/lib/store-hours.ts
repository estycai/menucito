import { describeNextOpening, hoursStatus, type Fulfillment, type HoursSlot } from "@menucito/shared";

export interface StoreHours {
  slots: readonly HoursSlot[];
  acceptOrdersOutsideHours: boolean;
}

/** What the order page shows about the opening hours, and whether it may send the order. */
export interface OrderHoursNotice {
  canOrder: boolean;
  /** Banner text; `null` while open (or for a store without hours). */
  text: string | null;
}

/**
 * The hours notice of the order page at `date`, for the chosen fulfillment (every slot counts until
 * one is chosen). Pausing orders is checked apart and takes priority over this.
 */
export function orderHoursNotice(hours: StoreHours, date: Date, fulfillment: Fulfillment | ""): OrderHoursNotice {
  const status = hoursStatus(hours, date, fulfillment || undefined);
  if (status.open) return { canOrder: true, text: null };
  const when = status.next ? describeNextOpening(status.next) : null;
  if (status.canOrder) {
    return {
      canOrder: true,
      text: when
        ? `Estamos cerrados. Tu pedido se va a preparar cuando abramos, ${when}.`
        : "Estamos cerrados. Tu pedido se va a preparar cuando abramos.",
    };
  }
  return { canOrder: false, text: when ? `Cerrado ahora. Abrimos ${when}.` : "Cerrado ahora." };
}
