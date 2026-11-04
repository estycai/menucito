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

/** What the menu page shows about the opening hours, and whether it lets the diner add to the order. */
export interface MenuHoursStatus {
  open: boolean;
  /** Open, or closed but accepting orders outside its hours. */
  canOrder: boolean;
  /** Badge next to the restaurant name: "Abierto" or "Cerrado · Abre hoy a las 18:00". */
  badge: string;
  /** Notice under the header while ordering is closed; `null` while the diner can order. */
  notice: string | null;
}

/**
 * The hours status of the menu page at `date`, counting every slot. `null` for a store without hours
 * (always open, nothing to show). Pausing orders is checked apart and takes priority over this.
 */
export function menuHoursStatus(hours: StoreHours, date: Date): MenuHoursStatus | null {
  if (hours.slots.length === 0) return null;
  const status = hoursStatus(hours, date);
  if (status.open) return { open: true, canOrder: true, badge: "Abierto", notice: null };
  const when = status.next ? describeNextOpening(status.next) : null;
  return {
    open: false,
    canOrder: status.canOrder,
    badge: when ? `Cerrado · Abre ${when}` : "Cerrado",
    notice: status.canOrder
      ? null
      : when
        ? `Ahora no tomamos pedidos. Podés mirar el menú; abrimos ${when}.`
        : "Ahora no tomamos pedidos. Podés mirar el menú.",
  };
}
