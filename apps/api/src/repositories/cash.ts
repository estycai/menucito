import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { CashMethod, CashSessionTotalsRow } from "@menucito/shared";
import {
  cashMovements,
  cashSessions,
  cashSessionTotals,
  orders,
  restaurantMembers,
  type CashMovementRow,
  type CashSessionRow,
  type NewCashMovementRow,
  type NewCashSessionRow,
  type OrderDbRow,
} from "../db/schema";
import { translatingUniqueViolations } from "./errors";

export interface CashOrderRecord {
  order: OrderDbRow;
  courierFirstName: string | null;
  courierLastName: string | null;
}

export interface CashMovementRecord {
  movement: CashMovementRow;
  courierFirstName: string | null;
  courierLastName: string | null;
  orderNumber: number | null;
}

export interface CashCourierEarningsRow {
  memberId: string;
  firstName: string;
  lastName: string;
  ordersCount: number;
  shippingCents: number;
  tipCents: number;
}

export interface CashPendingChangeRow {
  memberId: string;
  firstName: string;
  lastName: string;
  changeCents: number;
}

export interface CashMovementGroupRecord {
  first: CashMovementRow;
  rows: CashMovementRow[];
}

export interface CloseSessionData {
  countedCashCents: number;
  closeNote: string | null;
  closedByMemberId: string;
  closedByName: string;
  at: Date;
}

export interface CashRepository {
  findOpenSession(restaurantId: string): Promise<CashSessionRow | null>;
  findSession(restaurantId: string, sessionId: string): Promise<CashSessionRow | null>;
  lastClosedSession(restaurantId: string): Promise<CashSessionRow | null>;
  listClosed(
    restaurantId: string,
    page: number,
    limit: number,
  ): Promise<{ sessions: CashSessionRow[]; total: number }>;
  insertSession(row: NewCashSessionRow): Promise<CashSessionRow>;
  /** Closes the session and writes the totals snapshot in one batch; `false` when it was already closed. */
  closeSession(restaurantId: string, sessionId: string, data: CloseSessionData): Promise<boolean>;
  sessionTotals(sessionId: string): Promise<CashSessionTotalsRow[]>;
  sessionOrders(restaurantId: string, sessionId: string): Promise<CashOrderRecord[]>;
  sessionMovements(restaurantId: string, sessionId: string): Promise<CashMovementRecord[]>;
  listToSettle(restaurantId: string): Promise<CashOrderRecord[]>;
  courierEarnings(sessionId: string): Promise<CashCourierEarningsRow[]>;
  pendingChangeByCourier(restaurantId: string): Promise<CashPendingChangeRow[]>;
  paidWithoutSessionToday(
    restaurantId: string,
    fromMs: number,
    toMs: number,
  ): Promise<{ count: number; totalCents: number }>;
  insertMovements(rows: readonly NewCashMovementRow[]): Promise<void>;
  findMovementGroup(restaurantId: string, movementId: string): Promise<CashMovementGroupRecord | null>;
  replaceMovementGroup(
    restaurantId: string,
    firstId: string,
    groupId: string,
    changes: Pick<NewCashMovementRow, "method" | "amountCents" | "comment" | "editedByName" | "editedAt">,
    extraRows: readonly NewCashMovementRow[],
  ): Promise<void>;
  voidMovementGroup(restaurantId: string, groupId: string, byName: string, at: Date): Promise<void>;
  /** Marks an order paid into `cashSessionId` and inserts its automatic movements in one batch. */
  markOrderPaid(
    restaurantId: string,
    orderId: string,
    cashSessionId: string | null,
    paidAt: Date,
    movements: readonly NewCashMovementRow[],
  ): Promise<void>;
  /** Enters the orders into the session and inserts the split incomes / returned change, in one batch. */
  settleOrders(
    restaurantId: string,
    sessionId: string,
    orderIds: readonly string[],
    settledAt: Date,
    settledByMemberId: string,
    movements: readonly NewCashMovementRow[],
  ): Promise<void>;
  /** Leaves the order out of the session, deleting its automatic split incomes. */
  unsettleOrder(
    restaurantId: string,
    sessionId: string,
    orderId: string,
    settledAt: Date,
  ): Promise<void>;
  deleteOrderSplitIncomes(restaurantId: string, sessionId: string, orderId: string): Promise<void>;
  /** Cash orders delivered before the close that were not entered into the session. */
  onTheStreetOrders(restaurantId: string, sessionId: string, closedAt: Date): Promise<CashOrderRecord[]>;
}

export function createCashRepository(d1: D1Database): CashRepository {
  const db = drizzle(d1);

  const courierNames = {
    courierFirstName: restaurantMembers.firstName,
    courierLastName: restaurantMembers.lastName,
  };

  async function findOpenSession(restaurantId: string) {
    return (
      (await db
        .select()
        .from(cashSessions)
        .where(and(eq(cashSessions.restaurantId, restaurantId), isNull(cashSessions.closedAt)))
        .get()) ?? null
    );
  }

  async function sessionOrders(restaurantId: string, sessionId: string): Promise<CashOrderRecord[]> {
    return db
      .select({ order: orders, ...courierNames })
      .from(orders)
      .leftJoin(restaurantMembers, eq(restaurantMembers.id, orders.courierMemberId))
      .where(and(eq(orders.restaurantId, restaurantId), eq(orders.cashSessionId, sessionId)))
      .orderBy(asc(orders.number))
      .all();
  }

  return {
    findOpenSession,

    async findSession(restaurantId, sessionId) {
      return (
        (await db
          .select()
          .from(cashSessions)
          .where(and(eq(cashSessions.restaurantId, restaurantId), eq(cashSessions.id, sessionId)))
          .get()) ?? null
      );
    },

    async lastClosedSession(restaurantId) {
      return (
        (await db
          .select()
          .from(cashSessions)
          .where(and(eq(cashSessions.restaurantId, restaurantId), isNotNull(cashSessions.closedAt)))
          .orderBy(desc(cashSessions.closedAt))
          .limit(1)
          .get()) ?? null
      );
    },

    async listClosed(restaurantId, page, limit) {
      const where = and(eq(cashSessions.restaurantId, restaurantId), isNotNull(cashSessions.closedAt));
      const [rows, count] = await Promise.all([
        db
          .select()
          .from(cashSessions)
          .where(where)
          .orderBy(desc(cashSessions.closedAt))
          .limit(limit)
          .offset((page - 1) * limit)
          .all(),
        db.select({ count: sql<number>`count(*)` }).from(cashSessions).where(where).get(),
      ]);
      return { sessions: rows, total: Number(count?.count ?? 0) };
    },

    async insertSession(row) {
      const inserted = await translatingUniqueViolations(() =>
        db.insert(cashSessions).values(row).returning().get(),
      );
      if (!inserted) throw new Error("Cash session disappeared right after insert");
      return inserted;
    },

    async closeSession(restaurantId, sessionId, data) {
      // Expected cash repeats in `difference_cents`: SQLite evaluates every SET with the old row.
      const expected = `
        cash_sessions.opening_cash_cents
        + (SELECT COALESCE(SUM(o.total_cents), 0) FROM orders o
            WHERE o.cash_session_id = cash_sessions.id AND o.status <> 'cancelled' AND o.payment_method = 'cash')
        + (SELECT COALESCE(SUM(m.amount_cents), 0) FROM cash_movements m
            WHERE m.session_id = cash_sessions.id AND m.voided_at IS NULL AND m.method = 'cash'
              AND m.kind IN ('income','order_split_income','courier_change_back'))
        - (SELECT COALESCE(SUM(m.amount_cents), 0) FROM cash_movements m
            WHERE m.session_id = cash_sessions.id AND m.voided_at IS NULL AND m.method = 'cash'
              AND m.kind IN ('expense','courier_payment','courier_change_out'))`;

      const update = d1
        .prepare(
          `UPDATE cash_sessions
           SET closed_at = ?1, counted_cash_cents = ?2, expected_cash_cents = ${expected},
               difference_cents = ?2 - (${expected}), close_note = ?3,
               closed_by_member_id = ?4, closed_by_name = ?5
           WHERE id = ?6 AND restaurant_id = ?7 AND closed_at IS NULL`,
        )
        .bind(
          data.at.getTime(),
          data.countedCashCents,
          data.closeNote,
          data.closedByMemberId,
          data.closedByName,
          sessionId,
          restaurantId,
        );

      const totalsFor = (method: CashMethod) =>
        d1
          .prepare(
            `INSERT INTO cash_session_totals
               (session_id, method, sales_count, sales_cents, income_count, income_cents,
                expense_count, expense_cents, tip_count, tip_cents)
             SELECT s.id, '${method}',
               (SELECT COUNT(*) FROM orders o WHERE o.cash_session_id = s.id AND o.status <> 'cancelled' AND o.payment_method = '${method}'),
               (SELECT COALESCE(SUM(${method === "cash" ? "o.total_cents" : "MAX(o.total_cents - o.tip_cents, 0)"}), 0)
                  FROM orders o WHERE o.cash_session_id = s.id AND o.status <> 'cancelled' AND o.payment_method = '${method}'),
               (SELECT COUNT(*) FROM cash_movements m WHERE m.session_id = s.id AND m.voided_at IS NULL AND m.method = '${method}'
                  AND m.kind IN ('income','order_split_income','courier_change_back')),
               (SELECT COALESCE(SUM(m.amount_cents), 0) FROM cash_movements m WHERE m.session_id = s.id AND m.voided_at IS NULL AND m.method = '${method}'
                  AND m.kind IN ('income','order_split_income','courier_change_back')),
               (SELECT COUNT(*) FROM cash_movements m WHERE m.session_id = s.id AND m.voided_at IS NULL AND m.method = '${method}'
                  AND m.kind IN ('expense','courier_payment','courier_change_out')),
               (SELECT COALESCE(SUM(m.amount_cents), 0) FROM cash_movements m WHERE m.session_id = s.id AND m.voided_at IS NULL AND m.method = '${method}'
                  AND m.kind IN ('expense','courier_payment','courier_change_out')),
               (SELECT COUNT(*) FROM orders o WHERE o.cash_session_id = s.id AND o.status <> 'cancelled' AND o.payment_method = '${method}' AND o.tip_cents > 0),
               (SELECT COALESCE(SUM(o.tip_cents), 0) FROM orders o WHERE o.cash_session_id = s.id AND o.status <> 'cancelled' AND o.payment_method = '${method}')
             FROM cash_sessions s WHERE s.id = ?1 AND s.closed_at = ?2`,
          )
          .bind(sessionId, data.at.getTime());

      const results = await d1.batch([update, totalsFor("cash"), totalsFor("transfer")]);
      return Number(results[0]?.meta.changes ?? 0) === 1;
    },

    async sessionTotals(sessionId) {
      const rows = await db
        .select()
        .from(cashSessionTotals)
        .where(eq(cashSessionTotals.sessionId, sessionId))
        .all();
      return rows.map((row) => ({ ...row, method: row.method as CashMethod }));
    },

    sessionOrders,

    async sessionMovements(restaurantId, sessionId) {
      return db
        .select({
          movement: cashMovements,
          orderNumber: orders.number,
          ...courierNames,
        })
        .from(cashMovements)
        .leftJoin(orders, eq(orders.id, cashMovements.orderId))
        .leftJoin(restaurantMembers, eq(restaurantMembers.id, cashMovements.courierMemberId))
        .where(and(eq(cashMovements.restaurantId, restaurantId), eq(cashMovements.sessionId, sessionId)))
        .orderBy(desc(cashMovements.createdAt), desc(cashMovements.id))
        .all();
    },

    async listToSettle(restaurantId) {
      return db
        .select({ order: orders, ...courierNames })
        .from(orders)
        .leftJoin(restaurantMembers, eq(restaurantMembers.id, orders.courierMemberId))
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orders.status, "delivered"),
            eq(orders.paymentStatus, "paid"),
            inArray(orders.paymentMethod, ["cash", "split"]),
            isNull(orders.settledAt),
          ),
        )
        .orderBy(asc(orders.deliveredAt), asc(orders.number))
        .all();
    },

    async courierEarnings(sessionId) {
      const rows = await db
        .select({
          memberId: orders.courierMemberId,
          firstName: restaurantMembers.firstName,
          lastName: restaurantMembers.lastName,
          ordersCount: sql<number>`count(*)`,
          shippingCents: sql<number>`COALESCE(SUM(${orders.shippingCents}), 0)`,
          tipCents: sql<number>`COALESCE(SUM(${orders.tipCents}), 0)`,
        })
        .from(orders)
        .innerJoin(restaurantMembers, eq(restaurantMembers.id, orders.courierMemberId))
        .where(
          and(
            eq(orders.cashSessionId, sessionId),
            eq(orders.status, "delivered"),
            isNotNull(orders.courierMemberId),
          ),
        )
        .groupBy(orders.courierMemberId, restaurantMembers.firstName, restaurantMembers.lastName)
        .all();
      return rows.map((row) => ({
        memberId: row.memberId!,
        firstName: row.firstName,
        lastName: row.lastName,
        ordersCount: Number(row.ordersCount),
        shippingCents: Number(row.shippingCents),
        tipCents: Number(row.tipCents),
      }));
    },

    async pendingChangeByCourier(restaurantId) {
      const rows = await db
        .select({
          memberId: orders.courierMemberId,
          firstName: restaurantMembers.firstName,
          lastName: restaurantMembers.lastName,
          changeCents: sql<number>`COALESCE(SUM(
            MAX(COALESCE(${orders.cashTenderedCents}, 0) -
              CASE ${orders.paymentMethod}
                WHEN 'cash' THEN ${orders.totalCents}
                WHEN 'split' THEN COALESCE(${orders.splitCashCents}, 0)
                ELSE 0 END, 0)), 0)`,
        })
        .from(orders)
        .innerJoin(restaurantMembers, eq(restaurantMembers.id, orders.courierMemberId))
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orders.status, "sent"),
            isNotNull(orders.courierMemberId),
            isNotNull(orders.cashTenderedCents),
          ),
        )
        .groupBy(orders.courierMemberId, restaurantMembers.firstName, restaurantMembers.lastName)
        .all();
      return rows.map((row) => ({
        memberId: row.memberId!,
        firstName: row.firstName,
        lastName: row.lastName,
        changeCents: Number(row.changeCents),
      }));
    },

    async paidWithoutSessionToday(restaurantId, fromMs, toMs) {
      const row = await db
        .select({
          count: sql<number>`count(*)`,
          totalCents: sql<number>`COALESCE(SUM(${orders.totalCents}), 0)`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orders.paymentStatus, "paid"),
            isNull(orders.cashSessionId),
            ne(orders.status, "cancelled"),
            gte(orders.paidAt, new Date(fromMs)),
            lt(orders.paidAt, new Date(toMs)),
          ),
        )
        .get();
      return { count: Number(row?.count ?? 0), totalCents: Number(row?.totalCents ?? 0) };
    },

    async insertMovements(rows) {
      if (rows.length === 0) return;
      await db.insert(cashMovements).values([...rows]);
    },

    async findMovementGroup(restaurantId, movementId) {
      const first = await db
        .select()
        .from(cashMovements)
        .where(and(eq(cashMovements.restaurantId, restaurantId), eq(cashMovements.id, movementId)))
        .get();
      if (!first) return null;
      const rows = await db
        .select()
        .from(cashMovements)
        .where(and(eq(cashMovements.restaurantId, restaurantId), eq(cashMovements.groupId, first.groupId)))
        .orderBy(asc(cashMovements.createdAt), asc(cashMovements.id))
        .all();
      return { first, rows };
    },

    async replaceMovementGroup(restaurantId, firstId, groupId, changes, extraRows) {
      type BatchStatement = Parameters<typeof db.batch>[0][number];
      const statements: BatchStatement[] = [
        db
          .update(cashMovements)
          .set(changes)
          .where(and(eq(cashMovements.restaurantId, restaurantId), eq(cashMovements.id, firstId))),
        db
          .delete(cashMovements)
          .where(
            and(
              eq(cashMovements.restaurantId, restaurantId),
              eq(cashMovements.groupId, groupId),
              ne(cashMovements.id, firstId),
            ),
          ),
      ];
      for (const row of extraRows) statements.push(db.insert(cashMovements).values(row));
      await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
    },

    async voidMovementGroup(restaurantId, groupId, byName, at) {
      await db
        .update(cashMovements)
        .set({ voidedByName: byName, voidedAt: at })
        .where(and(eq(cashMovements.restaurantId, restaurantId), eq(cashMovements.groupId, groupId)));
    },

    async markOrderPaid(restaurantId, orderId, cashSessionId, paidAt, movements) {
      type BatchStatement = Parameters<typeof db.batch>[0][number];
      const statements: BatchStatement[] = [
        db
          .update(orders)
          .set({ paymentStatus: "paid", paidAt, cashSessionId })
          .where(
            and(
              eq(orders.restaurantId, restaurantId),
              eq(orders.id, orderId),
              ne(orders.paymentStatus, "paid"),
            ),
          ),
      ];
      for (const row of movements) statements.push(db.insert(cashMovements).values(row));
      await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
    },

    async settleOrders(restaurantId, sessionId, orderIds, settledAt, settledByMemberId, movements) {
      type BatchStatement = Parameters<typeof db.batch>[0][number];
      const statements: BatchStatement[] = [];
      for (const orderId of orderIds) {
        statements.push(
          db
            .update(orders)
            .set({ cashSessionId: sessionId, settledAt, settledByMemberId })
            .where(
              and(
                eq(orders.restaurantId, restaurantId),
                eq(orders.id, orderId),
                isNull(orders.settledAt),
              ),
            ),
        );
      }
      for (const row of movements) statements.push(db.insert(cashMovements).values(row));
      await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
    },

    async unsettleOrder(restaurantId, sessionId, orderId, settledAt) {
      type BatchStatement = Parameters<typeof db.batch>[0][number];
      await db.batch([
        db
          .delete(cashMovements)
          .where(
            and(
              eq(cashMovements.restaurantId, restaurantId),
              eq(cashMovements.sessionId, sessionId),
              eq(cashMovements.orderId, orderId),
              eq(cashMovements.kind, "order_split_income"),
            ),
          ),
        db
          .update(orders)
          .set({ cashSessionId: null, settledAt: null, settledByMemberId: null })
          .where(
            and(
              eq(orders.restaurantId, restaurantId),
              eq(orders.id, orderId),
              eq(orders.settledAt, settledAt),
            ),
          ),
      ] as [BatchStatement, BatchStatement]);
    },

    async deleteOrderSplitIncomes(restaurantId, sessionId, orderId) {
      await db
        .delete(cashMovements)
        .where(
          and(
            eq(cashMovements.restaurantId, restaurantId),
            eq(cashMovements.sessionId, sessionId),
            eq(cashMovements.orderId, orderId),
            eq(cashMovements.kind, "order_split_income"),
          ),
        );
    },

    async onTheStreetOrders(restaurantId, sessionId, closedAt) {
      return db
        .select({ order: orders, ...courierNames })
        .from(orders)
        .leftJoin(restaurantMembers, eq(restaurantMembers.id, orders.courierMemberId))
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orders.status, "delivered"),
            inArray(orders.paymentMethod, ["cash", "split"]),
            lt(orders.deliveredAt, closedAt),
            or(isNull(orders.settledAt), gte(orders.settledAt, closedAt)),
            or(isNull(orders.cashSessionId), ne(orders.cashSessionId, sessionId)),
          ),
        )
        .orderBy(asc(orders.deliveredAt), asc(orders.number))
        .all();
    },
  };
}

/** Maps a stored session to the shared shape. */
export function toCashSession(row: CashSessionRow) {
  return {
    id: row.id,
    openedAt: row.openedAt.getTime(),
    openingCashCents: row.openingCashCents,
    closedAt: row.closedAt?.getTime() ?? null,
    countedCashCents: row.countedCashCents,
    expectedCashCents: row.expectedCashCents,
    differenceCents: row.differenceCents,
    closeNote: row.closeNote,
    openedByName: row.openedByName,
    closedByName: row.closedByName,
  };
}
