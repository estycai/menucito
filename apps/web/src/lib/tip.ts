import {
  TIP_MAX_CENTS,
  TIP_MESSAGES,
  canHaveTip,
  tipFromPercent,
  type Fulfillment,
  type PaymentMethod,
} from "@menucito/shared";

/**
 * Pure logic of the diner's tip selector (change 13, scenarios 35 to 38). The component holds the
 * choice and the custom amount; everything that can be calculated or validated lives here.
 */

/** What the diner picked: a percentage from `TIP_PERCENTAGES`, "Otro monto", or nothing yet. */
export type TipChoice = number | "other" | null;

/** The tip only exists on delivery orders paid by transfer (decision 1); empty choices mean "not picked". */
export function tipAllowed(fulfillment: Fulfillment | "", paymentMethod: PaymentMethod | ""): boolean {
  if (!fulfillment || !paymentMethod) return false;
  return canHaveTip(fulfillment, paymentMethod);
}

/**
 * Whole pesos the diner typed in "Otro monto", in cents. An empty field is $0 (no tip); anything
 * that is not a whole number in range is `null`, so the caller can show `tipOtherError`.
 */
export function tipOtherCents(amount: string): number | null {
  const trimmed = amount.trim();
  if (trimmed === "") return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const cents = Number(trimmed) * 100;
  return cents > TIP_MAX_CENTS ? null : cents;
}

/** The error beside "Otro monto", or `undefined` when the amount is valid. */
export function tipOtherError(amount: string): string | undefined {
  return tipOtherCents(amount) === null ? TIP_MESSAGES.invalidAmount : undefined;
}

/**
 * Tip in cents for the current choice. A percentage is calculated over the products subtotal; an
 * invalid custom amount contributes nothing (the form blocks the submit and shows the error).
 */
export function tipCentsFor(choice: TipChoice, other: string, subtotalCents: number): number {
  if (choice === null) return 0;
  if (choice === "other") return tipOtherCents(other) ?? 0;
  return tipFromPercent(subtotalCents, choice);
}
