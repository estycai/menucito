import { z } from "zod";
import { formatArs } from "./catalog";
import type { PaymentMethod } from "./order";
import type { OrderCourier } from "./orders";

/** Method of a cash movement row: a split movement is stored as one `cash` and one `transfer` row. */
export const CASH_METHODS = ["cash", "transfer"] as const;
export type CashMethod = (typeof CASH_METHODS)[number];

/** Methods the "Nuevo movimiento" form offers; `split` is stored as two rows of the same group. */
export const CASH_PAYMENT_METHODS = ["cash", "transfer", "split"] as const;
export type CashPaymentMethod = (typeof CASH_PAYMENT_METHODS)[number];

export const CASH_MOVEMENT_KINDS = [
  "income",
  "expense",
  "courier_payment",
  "courier_change_out",
  "courier_change_back",
  "order_split_income",
] as const;
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number];

/** Kinds a member creates by hand; the others are created by an action of the cash screen. */
export const MANUAL_CASH_MOVEMENT_KINDS = ["income", "expense", "courier_payment"] as const;
export type ManualCashMovementKind = (typeof MANUAL_CASH_MOVEMENT_KINDS)[number];

export const CASH_METHOD_LABELS: Readonly<Record<CashPaymentMethod, string>> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  split: "Dividir pago",
};

export const CASH_MOVEMENT_KIND_LABELS: Readonly<Record<CashMovementKind, string>> = {
  income: "Ingreso",
  expense: "Egreso",
  courier_payment: "Pago a repartidor",
  courier_change_out: "Cambio entregado",
  courier_change_back: "Vuelve cambio",
  order_split_income: "Ingreso de pedido dividido",
};

export const CASH_COMMENT_MAX_LENGTH = 200;
export const CASH_CLOSE_NOTE_MAX_LENGTH = 200;
export const CASH_HISTORY_PAGE_SIZE = 20;
export const CASH_HISTORY_PAGE_SIZE_MAX = 50;

export const CASH_MESSAGES = {
  openingInvalid: "Ingresá un monto inicial entero, en pesos",
  amountInvalid: "Ingresá un monto entero mayor a $0",
  splitAmounts: "Cargá cuánto va en efectivo y cuánto por transferencia",
  splitBothPositive: "Las dos partes de un pago dividido tienen que ser mayores a $0",
  courierRequired: "Elegí un repartidor",
  courierSplit: "El pago a un repartidor va en efectivo o por transferencia",
  commentTooLong: `El comentario puede tener hasta ${CASH_COMMENT_MAX_LENGTH} caracteres`,
  commentRequired: "El comentario es obligatorio",
  closedCountedInvalid: "Ingresá el efectivo contado, aunque sea 0",
  noteTooLong: `La nota puede tener hasta ${CASH_CLOSE_NOTE_MAX_LENGTH} caracteres`,
  orderIdsRequired: "Elegí al menos un pedido",
  changeInvalid: "Ingresá un monto de cambio entero, puede ser 0",
  pageInvalid: "Página inválida",
  limitInvalid: `El límite debe ser un número entre 1 y ${CASH_HISTORY_PAGE_SIZE_MAX}`,
} as const;

const moneyCents = (message: string) => z.number(message).int(message).min(0, message);

/** Body of `POST /api/cash-sessions`. */
export const openCashSessionSchema = z.object({
  openingCashCents: moneyCents(CASH_MESSAGES.openingInvalid),
});

export type OpenCashSessionInput = z.infer<typeof openCashSessionSchema>;

const movementFields = {
  method: z.enum(CASH_PAYMENT_METHODS, "Método de pago inválido"),
  /** Whole amount of a cash or transfer movement; it is derived from the two parts on a split. */
  amountCents: moneyCents(CASH_MESSAGES.amountInvalid).optional(),
  cashCents: moneyCents(CASH_MESSAGES.amountInvalid).optional(),
  transferCents: moneyCents(CASH_MESSAGES.amountInvalid).optional(),
  comment: z.string().trim().max(CASH_COMMENT_MAX_LENGTH, CASH_MESSAGES.commentTooLong).optional(),
};

type MovementShape = {
  method: CashPaymentMethod;
  amountCents?: number;
  cashCents?: number;
  transferCents?: number;
  comment?: string;
};

function movementProblem(value: MovementShape): string | null {
  if (value.method === "split") {
    if (typeof value.cashCents !== "number" || typeof value.transferCents !== "number") {
      return CASH_MESSAGES.splitAmounts;
    }
    if (value.cashCents <= 0 || value.transferCents <= 0) return CASH_MESSAGES.splitBothPositive;
    return null;
  }
  return typeof value.amountCents === "number" && value.amountCents > 0 ? null : CASH_MESSAGES.amountInvalid;
}

/** Body of `POST /api/cash-sessions/current/movements`. */
export const createCashMovementSchema = z
  .object({
    kind: z.enum(MANUAL_CASH_MOVEMENT_KINDS, "Tipo de movimiento inválido"),
    ...movementFields,
    courierMemberId: z.string().trim().min(1, CASH_MESSAGES.courierRequired).optional(),
  })
  .superRefine((value, ctx) => {
    const problem = movementProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["amountCents"] });
    if (value.kind === "courier_payment" && !value.courierMemberId) {
      ctx.addIssue({ code: "custom", message: CASH_MESSAGES.courierRequired, path: ["courierMemberId"] });
    }
    if (value.kind === "courier_payment" && value.method === "split") {
      ctx.addIssue({ code: "custom", message: CASH_MESSAGES.courierSplit, path: ["method"] });
    }
  });

export type CreateCashMovementInput = z.infer<typeof createCashMovementSchema>;

/** Body of `PATCH /api/cash-sessions/current/movements/:id`. */
export const updateCashMovementSchema = z
  .object(movementFields)
  .superRefine((value, ctx) => {
    const problem = movementProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["amountCents"] });
  });

export type UpdateCashMovementInput = z.infer<typeof updateCashMovementSchema>;

/** Body of `POST /api/cash-sessions/current/close`. */
export const closeCashSessionSchema = z.object({
  countedCashCents: moneyCents(CASH_MESSAGES.closedCountedInvalid),
  note: z.string().trim().max(CASH_CLOSE_NOTE_MAX_LENGTH, CASH_MESSAGES.noteTooLong).optional(),
});

export type CloseCashSessionInput = z.infer<typeof closeCashSessionSchema>;

/** Body of `POST /api/cash-sessions/current/settlements`. */
export const settleOrdersSchema = z.object({
  orderIds: z
    .array(z.string().trim().min(1))
    .min(1, CASH_MESSAGES.orderIdsRequired)
    .max(100, "Podés ingresar hasta 100 pedidos juntos")
    .transform((ids) => [...new Set(ids)]),
  changeBackCents: moneyCents(CASH_MESSAGES.changeInvalid).optional(),
});

export type SettleOrdersInput = z.infer<typeof settleOrdersSchema>;

/** Body of `POST /api/cash-sessions/current/courier-change`. */
export const giveCourierChangeSchema = z.object({
  courierMemberId: z.string().trim().min(1, CASH_MESSAGES.courierRequired),
  amountCents: z.number(CASH_MESSAGES.amountInvalid).int(CASH_MESSAGES.amountInvalid).positive(CASH_MESSAGES.amountInvalid),
});

export type GiveCourierChangeInput = z.infer<typeof giveCourierChangeSchema>;

/** Query of `GET /api/cash-sessions`. */
export const cashHistoryQuerySchema = z.object({
  page: z.coerce
    .number(CASH_MESSAGES.pageInvalid)
    .int(CASH_MESSAGES.pageInvalid)
    .positive(CASH_MESSAGES.pageInvalid)
    .optional()
    .default(1),
  limit: z.coerce
    .number(CASH_MESSAGES.limitInvalid)
    .int(CASH_MESSAGES.limitInvalid)
    .positive(CASH_MESSAGES.limitInvalid)
    .max(CASH_HISTORY_PAGE_SIZE_MAX, CASH_MESSAGES.limitInvalid)
    .optional()
    .default(CASH_HISTORY_PAGE_SIZE),
});

export type CashHistoryQuery = z.infer<typeof cashHistoryQuerySchema>;

/** One sale of the cash session: an order paid into it. `amountCents` never includes the tip. */
export interface CashSale {
  method: CashMethod;
  amountCents: number;
  tipCents?: number;
}

/** What `computeCashTotals` needs about a movement; voided rows never count. */
export interface CashMovementTotalInput {
  method: CashMethod;
  kind: CashMovementKind;
  amountCents: number;
  voided?: boolean;
}

export interface CashMethodTotals {
  /** Only cash has an opening amount; `null` when the member may not see the expected. */
  openingCents: number | null;
  salesCount: number;
  salesCents: number;
  incomeCount: number;
  incomeCents: number | null;
  expenseCount: number;
  expenseCents: number | null;
  tipCount: number;
  tipCents: number;
  /** Cash: the expected in the drawer. Transfer: sales + tips + incomes − expenses. */
  totalCents: number | null;
}

export interface CashTotals {
  cash: CashMethodTotals;
  transfer: CashMethodTotals;
  /** Sales of every method, tips and split incomes excluded. */
  salesCount: number;
  salesCents: number;
  /** Cash total + transfer total; `null` when the member may not see the expected. */
  consolidatedCents: number | null;
  /** `null` when the member may not see the expected (blind close). */
  expectedCashCents: number | null;
}

export interface CashTotalsInput {
  openingCashCents: number;
  sales: readonly CashSale[];
  movements: readonly CashMovementTotalInput[];
}

const INCOME_KINDS: readonly CashMovementKind[] = ["income", "order_split_income", "courier_change_back"];
const EXPENSE_KINDS: readonly CashMovementKind[] = ["expense", "courier_payment", "courier_change_out"];

function emptyMethodTotals(openingCents: number): CashMethodTotals {
  return {
    openingCents,
    salesCount: 0,
    salesCents: 0,
    incomeCount: 0,
    incomeCents: 0,
    expenseCount: 0,
    expenseCents: 0,
    tipCount: 0,
    tipCents: 0,
    totalCents: 0,
  };
}

/**
 * Totals of a cash session, by method. Cancelled orders and voided movements must already be left
 * out by the caller. Split orders do not come as sales: they arrive as `order_split_income` rows.
 */
export function computeCashTotals({ openingCashCents, sales, movements }: CashTotalsInput): CashTotals {
  const cash = emptyMethodTotals(Math.max(0, Math.round(openingCashCents)));
  const transfer = emptyMethodTotals(0);

  for (const sale of sales) {
    const amount = Math.max(0, Math.round(sale.amountCents));
    const tip = Math.max(0, Math.round(sale.tipCents ?? 0));
    if (sale.method === "cash") {
      cash.salesCount += 1;
      cash.salesCents += amount;
    } else {
      transfer.salesCount += 1;
      transfer.salesCents += amount;
      if (tip > 0) {
        transfer.tipCount += 1;
        transfer.tipCents += tip;
      }
    }
  }

  for (const movement of movements) {
    if (movement.voided) continue;
    const amount = Math.max(0, Math.round(movement.amountCents));
    const target = movement.method === "cash" ? cash : transfer;
    if (INCOME_KINDS.includes(movement.kind)) {
      target.incomeCount += 1;
      target.incomeCents = (target.incomeCents ?? 0) + amount;
    } else if (EXPENSE_KINDS.includes(movement.kind)) {
      target.expenseCount += 1;
      target.expenseCents = (target.expenseCents ?? 0) + amount;
    }
  }

  cash.totalCents = (cash.openingCents ?? 0) + cash.salesCents + (cash.incomeCents ?? 0) - (cash.expenseCents ?? 0);
  transfer.totalCents =
    transfer.salesCents + transfer.tipCents + (transfer.incomeCents ?? 0) - (transfer.expenseCents ?? 0);

  return {
    cash,
    transfer,
    salesCount: cash.salesCount + transfer.salesCount,
    salesCents: cash.salesCents + transfer.salesCents,
    consolidatedCents: (cash.totalCents ?? 0) + (transfer.totalCents ?? 0),
    expectedCashCents: cash.totalCents,
  };
}

/** Hides the expected and the cash totals of a member without `cash.expected` (blind close). */
export function maskCashTotals(totals: CashTotals): CashTotals {
  return {
    ...totals,
    cash: {
      ...totals.cash,
      openingCents: null,
      incomeCents: null,
      expenseCents: null,
      totalCents: null,
    },
    consolidatedCents: null,
    expectedCashCents: null,
  };
}

export type CashDifferenceState = "surplus" | "shortage" | "balanced";

export interface CashDifference {
  cents: number;
  state: CashDifferenceState;
}

/** Counted − expected: positive is a surplus, negative a shortage. */
export function cashDifference(countedCashCents: number, expectedCashCents: number): CashDifference {
  const cents = Math.round(countedCashCents) - Math.round(expectedCashCents);
  return { cents, state: cents > 0 ? "surplus" : cents < 0 ? "shortage" : "balanced" };
}

/** "Sobrante $1.200", "Faltante $5.500" or "Sin diferencia". */
export function formatCashDifference(differenceCents: number): string {
  if (differenceCents === 0) return "Sin diferencia";
  return `${differenceCents > 0 ? "Sobrante" : "Faltante"} ${formatArs(Math.abs(differenceCents))}`;
}

/** Suggested payment to a courier: shipping + tips of his orders in this session − what he was paid. */
export function courierPaymentSuggestion(input: {
  shippingCents: number;
  tipCents: number;
  paidCents: number;
}): number {
  return Math.max(0, input.shippingCents + input.tipCents - input.paidCents);
}

/** Change the courier needs for his orders on the way (the sum of their change). */
export function courierChangeSuggestion(orders: readonly { changeCents: number | null }[]): number {
  return orders.reduce((sum, order) => sum + Math.max(0, order.changeCents ?? 0), 0);
}

/** Change a courier still owes: what left the drawer minus what came back. */
export function courierChangeBackSuggestion(changeOutCents: number, changeBackCents: number): number {
  return Math.max(0, changeOutCents - changeBackCents);
}

/** Name to show with a movement, from the comment or the kind and the courier. */
export function cashMovementLabel(movement: {
  kind: CashMovementKind;
  comment?: string | null;
  courier?: Pick<OrderCourier, "firstName" | "lastName"> | null;
}): string {
  const comment = movement.comment?.trim();
  if (comment) return comment;
  const name = movement.courier ? `${movement.courier.firstName} ${movement.courier.lastName}`.trim() : "repartidor";
  switch (movement.kind) {
    case "income":
      return "Ingreso";
    case "expense":
      return "Egreso";
    case "courier_payment":
      return `Pago a ${name}`;
    case "courier_change_out":
      return `Cambio a ${name}`;
    case "courier_change_back":
      return `Vuelve cambio ${name}`;
    case "order_split_income":
      return "Ingreso de pedido dividido";
  }
}

export interface CashMovementConceptInput {
  kind: CashMovementKind;
  comment?: string | null;
  amountCents: number;
  /** The oldest entry keeps its written form when the same concept repeats with another casing or spacing. */
  createdAt?: number;
}

export interface CashMovementConceptRow {
  kind: CashMovementKind;
  /** The first form written, or the label of the kind when the comment is empty. */
  concept: string;
  direction: "income" | "expense";
  count: number;
  amountCents: number;
}

const normalizeConcept = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");

/**
 * Groups the movements of the Arqueos report by kind and by their comment, ignoring case and extra
 * spaces (change 16c). The amount adds up every movement of the group.
 */
export function groupCashMovements(entries: readonly CashMovementConceptInput[]): CashMovementConceptRow[] {
  const groups = new Map<string, { row: CashMovementConceptRow; firstAt: number }>();
  for (const entry of entries) {
    const concept = entry.comment?.trim() || CASH_MOVEMENT_KIND_LABELS[entry.kind];
    const key = `${entry.kind}\u0000${normalizeConcept(concept)}`;
    const direction = INCOME_KINDS.includes(entry.kind) ? "income" : "expense";
    const amount = Math.max(0, Math.round(entry.amountCents));
    const at = entry.createdAt ?? Number.MAX_SAFE_INTEGER;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { row: { kind: entry.kind, concept, direction, count: 1, amountCents: amount }, firstAt: at });
      continue;
    }
    existing.row.count += 1;
    existing.row.amountCents += amount;
    if (at < existing.firstAt) {
      existing.row.concept = concept;
      existing.firstAt = at;
    }
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        CASH_MOVEMENT_KINDS.indexOf(a.row.kind) - CASH_MOVEMENT_KINDS.indexOf(b.row.kind) ||
        a.row.concept.localeCompare(b.row.concept, "es", { sensitivity: "base" }),
    )
    .map((group) => group.row);
}

// ---------------------------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------------------------

export interface CashSession {
  id: string;
  openedAt: number;
  openingCashCents: number;
  closedAt: number | null;
  countedCashCents: number | null;
  expectedCashCents: number | null;
  differenceCents: number | null;
  closeNote: string | null;
  openedByName: string;
  closedByName: string | null;
}

/** A movement as the admin sees it: a split is one entry with both parts. */
export interface CashMovement {
  id: string;
  groupId: string;
  kind: CashMovementKind;
  method: CashPaymentMethod;
  amountCents: number;
  cashCents: number;
  transferCents: number;
  comment: string;
  orderId: string | null;
  orderNumber: number | null;
  courier: OrderCourier | null;
  createdByName: string;
  createdAt: number;
  editedByName: string | null;
  editedAt: number | null;
  voidedByName: string | null;
  voidedAt: number | null;
  /** `order_split_income`: generated by a split order, never edited or voided by hand. */
  automatic: boolean;
}

export interface CashSettlementOrder {
  id: string;
  number: number;
  customerName: string;
  paymentMethod: PaymentMethod;
  cashCents: number;
  transferCents: number;
  deliveredAt: number | null;
}

/** Orders of one courier waiting to be entered into the open cash. */
export interface CashSettlementGroup {
  courier: OrderCourier | null;
  orders: CashSettlementOrder[];
  /** The cash part the courier brings; split transfers enter with it but are not part of this total. */
  ordersCents: number;
  /** Change given to the courier in this session that has not come back yet. */
  changeOutCents: number;
  /** Change he needs for his orders on the way. */
  changeSuggestionCents: number;
}

/** Suggested payment to a courier, from the orders and movements of the open session. */
export interface CashCourierAccount {
  courier: OrderCourier;
  ordersCount: number;
  shippingCents: number;
  tipCents: number;
  paidCents: number;
  suggestedCents: number;
  changeOutCents: number;
  changeSuggestionCents: number;
}

export interface CashOnTheStreet {
  ordersCents: number;
  changeCents: number;
  totalCents: number;
}

export interface CashCurrent {
  session: CashSession | null;
  /** `null` when there is no open session or the member may not see the expected. */
  totals: CashTotals | null;
  movements: CashMovement[];
  /** Counted at the previous close, or 0. */
  openingSuggestionCents: number;
  chargedWithoutCashToday: { count: number; totalCents: number };
  toSettle: CashSettlementGroup[];
  courierAccounts: CashCourierAccount[];
  onTheStreet: CashOnTheStreet;
  /** Past the store's closing time; a hint, it never forces a close. */
  storeClosed: boolean;
  lastClosed: CashSession | null;
}

export interface CashCourierIncome {
  courier: OrderCourier | null;
  ordersCount: number;
  cents: number;
  settledByName: string | null;
  settledAt: number | null;
}

export interface CashOnTheStreetGroup {
  courier: OrderCourier | null;
  ordersCount: number;
  ordersCents: number;
  changeCents: number;
  totalCents: number;
}

/** A closed session as the detail and print pages read it; totals come from the close snapshot. */
export interface CashSessionDetail {
  session: CashSession;
  totals: CashTotals;
  movements: CashMovement[];
  courierIncomes: CashCourierIncome[];
  courierPayments: CashMovement[];
  tipsCents: number;
  onTheStreet: CashOnTheStreetGroup[];
  onTheStreetCents: number;
}

export interface CashCloseResult {
  detail: CashSessionDetail;
  pending: { count: number; totalCents: number; couriers: string[] };
}

export interface CashHistory {
  sessions: CashSession[];
  page: number;
  limit: number;
  total: number;
}

export interface CashSessionTotalsRow {
  method: CashMethod;
  salesCount: number;
  salesCents: number;
  incomeCount: number;
  incomeCents: number;
  expenseCount: number;
  expenseCents: number;
  tipCount: number;
  tipCents: number;
}

/** Totals of a closed session, rebuilt from its `cash_session_totals` snapshot. */
export function cashTotalsFromSnapshot(
  session: CashSession,
  rows: readonly CashSessionTotalsRow[],
): CashTotals {
  const rowFor = (method: CashMethod): CashMethodTotals => {
    const row = rows.find((candidate) => candidate.method === method);
    return {
      openingCents: method === "cash" ? session.openingCashCents : 0,
      salesCount: row?.salesCount ?? 0,
      salesCents: row?.salesCents ?? 0,
      incomeCount: row?.incomeCount ?? 0,
      incomeCents: row?.incomeCents ?? 0,
      expenseCount: row?.expenseCount ?? 0,
      expenseCents: row?.expenseCents ?? 0,
      tipCount: row?.tipCount ?? 0,
      tipCents: row?.tipCents ?? 0,
      totalCents: 0,
    };
  };
  const cash = rowFor("cash");
  const transfer = rowFor("transfer");
  cash.totalCents = (cash.openingCents ?? 0) + cash.salesCents + (cash.incomeCents ?? 0) - (cash.expenseCents ?? 0);
  transfer.totalCents = transfer.salesCents + transfer.tipCents + (transfer.incomeCents ?? 0) - (transfer.expenseCents ?? 0);
  return {
    cash,
    transfer,
    salesCount: cash.salesCount + transfer.salesCount,
    salesCents: cash.salesCents + transfer.salesCents,
    consolidatedCents: (cash.totalCents ?? 0) + (transfer.totalCents ?? 0),
    expectedCashCents: session.expectedCashCents ?? cash.totalCents,
  };
}
