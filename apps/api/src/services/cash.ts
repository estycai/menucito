import {
  cashMovementLabel,
  cashTotalsFromSnapshot,
  computeCashTotals,
  courierPaymentSuggestion,
  hoursStatus,
  localDateKey,
  localDayRange,
  maskCashTotals,
  type CashCourierAccount,
  type CashCurrent,
  type CashHistory,
  type CashHistoryQuery,
  type CashMethod,
  type CashMovement,
  type CashMovementKind,
  type CashOnTheStreetGroup,
  type CashSale,
  type CashSessionDetail,
  type CashSettlementGroup,
  type CashSettlementOrder,
  type CashCloseResult,
  type CloseCashSessionInput,
  type CreateCashMovementInput,
  type GiveCourierChangeInput,
  type OpenCashSessionInput,
  type OrderCourier,
  type OrderDetail,
  type SettleOrdersInput,
  type UpdateCashMovementInput,
  planLimitsFor,
} from "@menucito/shared";
import type { MemberContext } from "../env";
import type { CashMovementRecord, CashOrderRecord, CashRepository } from "../repositories/cash";
import { createCashRepository, toCashSession } from "../repositories/cash";
import { UniqueViolationError } from "../repositories/errors";
import { createHoursRepository, type HoursRepository } from "../repositories/hours";
import { createMembersRepository, type MembersRepository } from "../repositories/members";
import { createOrdersRepository, type OrdersRepository } from "../repositories/orders";
import {
  createRestaurantsRepository,
  type RestaurantsRepository,
} from "../repositories/restaurants";
import {
  CashMovementNotFoundError,
  CashSessionAlreadyOpenError,
  CashSessionClosedError,
  CashSessionNotFoundError,
  MovementLockedError,
  NoOpenCashSessionError,
  OrderNotFoundError,
  PlanFeatureError,
  RestaurantNotFoundError,
  ValidationError,
} from "./errors";

type NewMovementRow = Parameters<CashRepository["insertMovements"]>[0][number];

export interface CashDependencies {
  cash: CashRepository;
  orders: OrdersRepository;
  members: MembersRepository;
  restaurants: RestaurantsRepository;
  hours: HoursRepository;
  now?: () => Date;
  generateId?: () => string;
  /** Injectable so a test can simulate a plan without the cash drawer. */
  limitsFor?: typeof planLimitsFor;
}

/** Name of a member for the audit trail; "Usuario" only if the row disappeared meanwhile. */
async function memberName(members: MembersRepository, restaurantId: string, memberId: string): Promise<string> {
  const record = await members.find(restaurantId, memberId);
  return record ? `${record.member.firstName} ${record.member.lastName}`.trim() || "Usuario" : "Usuario";
}

function courierOfRecord(record: {
  order: { courierMemberId: string | null };
  courierFirstName: string | null;
  courierLastName: string | null;
}): OrderCourier | null {
  if (!record.order.courierMemberId || !record.courierFirstName) return null;
  return {
    memberId: record.order.courierMemberId,
    firstName: record.courierFirstName,
    lastName: record.courierLastName ?? "",
  };
}

function courierOfMovement(record: CashMovementRecord): OrderCourier | null {
  if (!record.movement.courierMemberId || !record.courierFirstName) return null;
  return {
    memberId: record.movement.courierMemberId,
    firstName: record.courierFirstName,
    lastName: record.courierLastName ?? "",
  };
}

/** A split movement is stored as two rows of the same group and shown as one entry. */
function groupMovements(records: readonly CashMovementRecord[]): CashMovement[] {
  const groups = new Map<string, CashMovementRecord[]>();
  for (const record of records) {
    const list = groups.get(record.movement.groupId) ?? [];
    list.push(record);
    groups.set(record.movement.groupId, list);
  }

  const entries: CashMovement[] = [];
  for (const [groupId, group] of groups) {
    const first = group[0]!;
    const cashRow = group.find((row) => row.movement.method === "cash");
    const transferRow = group.find((row) => row.movement.method === "transfer");
    const cashCents = cashRow?.movement.amountCents ?? 0;
    const transferCents = transferRow?.movement.amountCents ?? 0;
    // Only a hand-made split shares its group between a cash and a transfer row; automatic split
    // incomes are two independent entries.
    const method =
      first.movement.kind !== "order_split_income" && cashRow && transferRow ? "split" : (first.movement.method as CashMethod);
    const createdAt = Math.max(...group.map((row) => row.movement.createdAt.getTime()));
    const editedAt = group.reduce<number | null>((latest, row) => {
      const value = row.movement.editedAt?.getTime() ?? null;
      return value !== null && (latest === null || value > latest) ? value : latest;
    }, null);
    const courier = courierOfMovement(first);
    const kind = first.movement.kind as CashMovementKind;
    entries.push({
      id: first.movement.id,
      groupId,
      kind,
      method,
      amountCents: cashCents + transferCents,
      cashCents,
      transferCents,
      comment: cashMovementLabel({ kind, comment: first.movement.comment, courier }),
      orderId: first.movement.orderId,
      orderNumber: first.orderNumber,
      courier,
      createdByName: first.movement.createdByName,
      createdAt,
      editedByName: first.movement.editedByName,
      editedAt,
      voidedByName: first.movement.voidedByName,
      voidedAt: first.movement.voidedAt?.getTime() ?? null,
      automatic: kind === "order_split_income",
    });
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

interface ChangeTotals {
  outCents: number;
  backCents: number;
}

function changeByCourier(records: readonly CashMovementRecord[]): Map<string, ChangeTotals> {
  const map = new Map<string, ChangeTotals>();
  for (const { movement } of records) {
    if (movement.kind !== "courier_change_out" && movement.kind !== "courier_change_back") continue;
    if (movement.voidedAt || !movement.courierMemberId) continue;
    const current = map.get(movement.courierMemberId) ?? { outCents: 0, backCents: 0 };
    if (movement.kind === "courier_change_out") current.outCents += movement.amountCents;
    else current.backCents += movement.amountCents;
    map.set(movement.courierMemberId, current);
  }
  return map;
}

function toSettlementOrder(record: CashOrderRecord): CashSettlementOrder {
  const order = record.order;
  const total = order.totalCents;
  const cashCents =
    order.paymentMethod === "cash"
      ? total
      : order.paymentMethod === "split"
        ? Math.min(total, Math.max(0, order.splitCashCents ?? 0))
        : 0;
  return {
    id: order.id,
    number: order.number,
    customerName: order.customerName,
    paymentMethod: order.paymentMethod as CashSettlementOrder["paymentMethod"],
    cashCents,
    transferCents: total - cashCents,
    deliveredAt: order.deliveredAt?.getTime() ?? null,
  };
}

function toSettlementGroups(
  records: readonly CashOrderRecord[],
  movements: readonly CashMovementRecord[],
  pendingChange: ReadonlyMap<string, number>,
): CashSettlementGroup[] {
  const changes = changeByCourier(movements);
  const groups = new Map<string, { courier: OrderCourier | null; orders: CashSettlementOrder[] }>();
  for (const record of records) {
    const courier = courierOfRecord(record);
    const key = courier?.memberId ?? "none";
    const group = groups.get(key) ?? { courier, orders: [] };
    group.orders.push(toSettlementOrder(record));
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const change = changes.get(key);
      return {
        courier: group.courier,
        orders: group.orders,
        ordersCents: group.orders.reduce((sum, order) => sum + order.cashCents, 0),
        changeOutCents: Math.max(0, (change?.outCents ?? 0) - (change?.backCents ?? 0)),
        changeSuggestionCents: pendingChange.get(key) ?? 0,
      };
    })
    .sort((a, b) => {
      if (!a.courier) return 1;
      if (!b.courier) return -1;
      return `${a.courier.firstName} ${a.courier.lastName}`.localeCompare(`${b.courier.firstName} ${b.courier.lastName}`);
    });
}

function onTheStreetFrom(
  groups: readonly CashSettlementGroup[],
  movements: readonly CashMovementRecord[],
): { ordersCents: number; changeCents: number; totalCents: number } {
  const ordersCents = groups.reduce((sum, group) => sum + group.ordersCents, 0);
  const changes = changeByCourier(movements);
  let changeCents = 0;
  for (const change of changes.values()) changeCents += Math.max(0, change.outCents - change.backCents);
  return { ordersCents, changeCents, totalCents: ordersCents + changeCents };
}

/** Automatic cash incomes of a split order: one per part, each one its own entry. */
export function buildOrderSplitIncomeRows(
  order: OrderDetail,
  restaurantId: string,
  sessionId: string,
  member: Pick<MemberContext, "memberId">,
  createdByName: string,
  now: Date,
  generateId: () => string,
): NewMovementRow[] {
  const rows: NewMovementRow[] = [];
  const parts: { method: CashMethod; amountCents: number; label: string }[] = [
    { method: "cash", amountCents: order.paymentBreakdown.cashCents, label: "Efectivo" },
    { method: "transfer", amountCents: order.paymentBreakdown.transferCents, label: "Transferencia" },
  ];
  for (const part of parts) {
    if (part.amountCents <= 0) continue;
    rows.push({
      id: generateId(),
      groupId: generateId(),
      restaurantId,
      sessionId,
      kind: "order_split_income",
      method: part.method,
      amountCents: part.amountCents,
      comment: `Ingreso Pedido #${order.number} - ${part.label}`,
      orderId: order.id,
      courierMemberId: order.courier?.memberId ?? null,
      createdAt: now,
      createdByMemberId: member.memberId,
      createdByName,
    });
  }
  return rows;
}

export function createCashService({
  cash,
  orders,
  members,
  restaurants,
  hours,
  now = () => new Date(),
  generateId = () => crypto.randomUUID(),
  limitsFor = planLimitsFor,
}: CashDependencies) {
  async function assertPlan(restaurantId: string) {
    const restaurant = await restaurants.findById(restaurantId);
    if (!restaurant) throw new RestaurantNotFoundError();
    if (!limitsFor(restaurant.plan).cashRegister) {
      throw new PlanFeatureError("Las cajas y arqueos no están incluidos en tu plan");
    }
    return restaurant;
  }

  async function openSession(restaurantId: string) {
    const session = await cash.findOpenSession(restaurantId);
    if (!session) throw new NoOpenCashSessionError();
    return session;
  }

  async function current(restaurantId: string, canSeeExpected: boolean): Promise<CashCurrent> {
    await assertPlan(restaurantId);
    const [session, lastClosed, slots, pendingChangeRows] = await Promise.all([
      cash.findOpenSession(restaurantId),
      cash.lastClosedSession(restaurantId),
      hours.listSlots(restaurantId),
      cash.pendingChangeByCourier(restaurantId),
    ]);
    const today = localDateKey(now().getTime());
    const [fromMs, toMs] = localDayRange(today);
    const charged = await cash.paidWithoutSessionToday(restaurantId, fromMs, toMs);
    const storeClosed = !hoursStatus({ slots, acceptOrdersOutsideHours: false }, now()).open;
    const lastClosedView = lastClosed ? toCashSession(lastClosed) : null;

    if (!session) {
      return {
        session: null,
        totals: null,
        movements: [],
        openingSuggestionCents: lastClosed?.countedCashCents ?? 0,
        chargedWithoutCashToday: charged,
        toSettle: [],
        courierAccounts: [],
        onTheStreet: { ordersCents: 0, changeCents: 0, totalCents: 0 },
        storeClosed,
        lastClosed: lastClosedView,
      };
    }

    const [orderRecords, movementRecords, earnings, toSettleRecords, activeCouriers] = await Promise.all([
      cash.sessionOrders(restaurantId, session.id),
      cash.sessionMovements(restaurantId, session.id),
      cash.courierEarnings(session.id),
      cash.listToSettle(restaurantId),
      orders.listCouriers(restaurantId),
    ]);

    const sales: CashSale[] = [];
    for (const { order } of orderRecords) {
      if (order.status === "cancelled" || order.paymentMethod === "split") continue;
      if (order.paymentMethod === "cash") {
        sales.push({ method: "cash", amountCents: order.totalCents });
      } else if (order.paymentMethod === "transfer") {
        sales.push({ method: "transfer", amountCents: order.totalCents - order.tipCents, tipCents: order.tipCents });
      }
    }

    const computed = computeCashTotals({
      openingCashCents: session.openingCashCents,
      sales,
      movements: movementRecords.map(({ movement }) => ({
        method: movement.method as CashMethod,
        kind: movement.kind as CashMovementKind,
        amountCents: movement.amountCents,
        voided: Boolean(movement.voidedAt),
      })),
    });

    const pendingChange = new Map(pendingChangeRows.map((row) => [row.memberId, row.changeCents]));
    const toSettle = toSettlementGroups(toSettleRecords, movementRecords, pendingChange);
    const changes = changeByCourier(movementRecords);
    const paidByCourier = new Map<string, number>();
    for (const { movement } of movementRecords) {
      if (movement.kind !== "courier_payment" || movement.voidedAt || !movement.courierMemberId) continue;
      paidByCourier.set(movement.courierMemberId, (paidByCourier.get(movement.courierMemberId) ?? 0) + movement.amountCents);
    }
    const earningsById = new Map(earnings.map((row) => [row.memberId, row]));
    const courierAccounts: CashCourierAccount[] = activeCouriers.map((courier) => {
      const earning = earningsById.get(courier.memberId);
      const paidCents = paidByCourier.get(courier.memberId) ?? 0;
      const change = changes.get(courier.memberId);
      return {
        courier: { memberId: courier.memberId, firstName: courier.firstName, lastName: courier.lastName },
        ordersCount: earning?.ordersCount ?? 0,
        shippingCents: earning?.shippingCents ?? 0,
        tipCents: earning?.tipCents ?? 0,
        paidCents,
        suggestedCents: courierPaymentSuggestion({
          shippingCents: earning?.shippingCents ?? 0,
          tipCents: earning?.tipCents ?? 0,
          paidCents,
        }),
        changeOutCents: Math.max(0, (change?.outCents ?? 0) - (change?.backCents ?? 0)),
        changeSuggestionCents: pendingChange.get(courier.memberId) ?? 0,
      };
    });

    return {
      session: toCashSession(session),
      totals: canSeeExpected ? computed : maskCashTotals(computed),
      movements: groupMovements(movementRecords),
      openingSuggestionCents: lastClosed?.countedCashCents ?? 0,
      chargedWithoutCashToday: charged,
      toSettle,
      courierAccounts,
      onTheStreet: onTheStreetFrom(toSettle, movementRecords),
      storeClosed,
      lastClosed: lastClosedView,
    };
  }

  async function detail(restaurantId: string, sessionId: string): Promise<CashSessionDetail> {
    await assertPlan(restaurantId);
    const session = await cash.findSession(restaurantId, sessionId);
    if (!session) throw new CashSessionNotFoundError();
    const sessionView = toCashSession(session);
    const [rows, orderRecords, movementRecords] = await Promise.all([
      cash.sessionTotals(sessionId),
      cash.sessionOrders(restaurantId, sessionId),
      cash.sessionMovements(restaurantId, sessionId),
    ]);

    let totals: CashSessionDetail["totals"];
    if (session.closedAt) {
      totals = cashTotalsFromSnapshot(sessionView, rows);
    } else {
      const sales: CashSale[] = [];
      for (const { order } of orderRecords) {
        if (order.status === "cancelled" || order.paymentMethod === "split") continue;
        if (order.paymentMethod === "cash") sales.push({ method: "cash", amountCents: order.totalCents });
        else sales.push({ method: "transfer", amountCents: order.totalCents - order.tipCents, tipCents: order.tipCents });
      }
      totals = computeCashTotals({
        openingCashCents: session.openingCashCents,
        sales,
        movements: movementRecords.map(({ movement }) => ({
          method: movement.method as CashMethod,
          kind: movement.kind as CashMovementKind,
          amountCents: movement.amountCents,
          voided: Boolean(movement.voidedAt),
        })),
      });
    }

    const incomes = new Map<string, { courier: OrderCourier | null; ordersCount: number; cents: number; settledAt: number | null }>();
    for (const record of orderRecords) {
      if (record.order.status === "cancelled") continue;
      if (record.order.paymentMethod !== "cash" && record.order.paymentMethod !== "split") continue;
      // Only what a courier handed in with "Ingresar a la caja": takeaway sales are not courier incomes.
      if (!record.order.settledAt) continue;
      const courier = courierOfRecord(record);
      const key = courier?.memberId ?? "none";
      const total = record.order.totalCents;
      const cashCents =
        record.order.paymentMethod === "cash" ? total : Math.min(total, Math.max(0, record.order.splitCashCents ?? 0));
      const currentIncome = incomes.get(key) ?? { courier, ordersCount: 0, cents: 0, settledAt: null };
      const settledAt = record.order.settledAt?.getTime() ?? null;
      currentIncome.ordersCount += 1;
      currentIncome.cents += cashCents;
      currentIncome.settledAt =
        settledAt !== null && (currentIncome.settledAt === null || settledAt > currentIncome.settledAt)
          ? settledAt
          : currentIncome.settledAt;
      incomes.set(key, currentIncome);
    }

    const courierPayments = groupMovements(movementRecords).filter(
      (movement) => movement.kind === "courier_payment" && !movement.voidedAt,
    );

    let onTheStreet: CashOnTheStreetGroup[] = [];
    if (session.closedAt) {
      const [leftOnStreet] = await Promise.all([
        cash.onTheStreetOrders(restaurantId, session.id, session.closedAt),
      ]);
      const byCourier = new Map<
        string,
        { courier: OrderCourier | null; ordersCount: number; ordersCents: number; changeCents?: number }
      >();
      for (const record of leftOnStreet) {
        const courier = courierOfRecord(record);
        const key = courier?.memberId ?? "none";
        const total = record.order.totalCents;
        const cashCents =
          record.order.paymentMethod === "cash" ? total : Math.min(total, Math.max(0, record.order.splitCashCents ?? 0));
        const currentGroup = byCourier.get(key) ?? { courier, ordersCount: 0, ordersCents: 0 };
        currentGroup.ordersCount += 1;
        currentGroup.ordersCents += cashCents;
        byCourier.set(key, currentGroup);
      }
      const changes = changeByCourier(movementRecords);
      for (const [key, change] of changes) {
        const currentGroup = byCourier.get(key) ?? {
          courier: activeCourierFromPayload(movementRecords, key),
          ordersCount: 0,
          ordersCents: 0,
          changeCents: 0,
        };
        currentGroup.changeCents = Math.max(0, change.outCents - change.backCents);
        byCourier.set(key, currentGroup);
      }
      onTheStreet = [...byCourier.values()].map((group) => ({
        courier: group.courier,
        ordersCount: group.ordersCount,
        ordersCents: group.ordersCents,
        changeCents: group.changeCents ?? 0,
        totalCents: group.ordersCents + (group.changeCents ?? 0),
      }));
    }

    return {
      session: sessionView,
      totals,
      movements: groupMovements(movementRecords),
      courierIncomes: [...incomes.values()].map((income) => ({
        courier: income.courier,
        ordersCount: income.ordersCount,
        cents: income.cents,
        settledByName: null,
        settledAt: income.settledAt,
      })),
      courierPayments,
      tipsCents: totals.transfer.tipCents,
      onTheStreet,
      onTheStreetCents: onTheStreet.reduce((sum, group) => sum + group.totalCents, 0),
    };
  }

  function activeCourierFromPayload(records: readonly CashMovementRecord[], memberId: string): OrderCourier | null {
    for (const record of records) {
      if (record.movement.courierMemberId === memberId && record.courierFirstName) {
        return {
          memberId,
          firstName: record.courierFirstName,
          lastName: record.courierLastName ?? "",
        };
      }
    }
    return null;
  }

  return {
    current,
    detail,

    async open(restaurantId: string, member: MemberContext, input: OpenCashSessionInput) {
      await assertPlan(restaurantId);
      const name = await memberName(members, restaurantId, member.memberId);
      try {
        const created = await cash.insertSession({
          id: generateId(),
          restaurantId,
          openedAt: now(),
          openingCashCents: input.openingCashCents,
          openedByMemberId: member.memberId,
          openedByName: name,
        });
        return toCashSession(created);
      } catch (error) {
        if (error instanceof UniqueViolationError) throw new CashSessionAlreadyOpenError();
        throw error;
      }
    },

    async createMovement(restaurantId: string, member: MemberContext, input: CreateCashMovementInput) {
      await assertPlan(restaurantId);
      const session = await openSession(restaurantId);
      const name = await memberName(members, restaurantId, member.memberId);

      let courier: { memberId: string; firstName: string; lastName: string } | null = null;
      if (input.kind === "courier_payment") {
        if (!input.courierMemberId) throw new ValidationError("Elegí un repartidor");
        const record = await members.find(restaurantId, input.courierMemberId);
        if (!record || !record.member.active || !record.member.isCourier) {
          throw new ValidationError("courierMemberId: elegí un repartidor activo de tu local");
        }
        courier = { memberId: record.member.id, firstName: record.member.firstName, lastName: record.member.lastName };
      }

      const kind = input.kind;
      const groupId = generateId();
      const common = {
        restaurantId,
        sessionId: session.id,
        kind,
        orderId: null,
        courierMemberId: courier?.memberId ?? null,
        createdAt: now(),
        createdByMemberId: member.memberId,
        createdByName: name,
      } satisfies Partial<NewMovementRow>;
      const fallbackComment = cashMovementLabel({ kind, courier });
      const comment = input.comment?.trim() ? input.comment.trim() : fallbackComment;

      const rows: NewMovementRow[] =
        input.method === "split"
          ? [
              { ...common, id: generateId(), groupId, method: "cash", amountCents: input.cashCents ?? 0, comment },
              { ...common, id: generateId(), groupId, method: "transfer", amountCents: input.transferCents ?? 0, comment },
            ]
          : [
              {
                ...common,
                id: generateId(),
                groupId,
                method: input.method,
                amountCents: input.amountCents ?? 0,
                comment,
              },
            ];
      await cash.insertMovements(rows);
    },

    async editMovement(restaurantId: string, member: MemberContext, movementId: string, input: UpdateCashMovementInput) {
      await assertPlan(restaurantId);
      const session = await openSession(restaurantId);
      const group = await cash.findMovementGroup(restaurantId, movementId);
      if (!group) throw new CashMovementNotFoundError();
      if (group.first.sessionId !== session.id) throw new CashSessionClosedError();
      if (group.first.voidedAt) throw new MovementLockedError("Ese movimiento ya está anulado");
      const kind = group.first.kind as CashMovementKind;
      if (kind === "order_split_income" || kind === "courier_change_out" || kind === "courier_change_back") {
        throw new MovementLockedError();
      }
      if (kind === "courier_payment" && input.method === "split") {
        throw new ValidationError("El pago a un repartidor va en efectivo o por transferencia");
      }

      const name = await memberName(members, restaurantId, member.memberId);
      const at = now();
      const comment = input.comment?.trim() ? input.comment.trim() : null;
      const isSplit = input.method === "split";
      const firstMethod: CashMethod = input.method === "split" ? "cash" : input.method;
      const firstAmount = isSplit ? (input.cashCents ?? 0) : (input.amountCents ?? 0);
      const extraRows: NewMovementRow[] = isSplit
        ? [
            {
              ...group.first,
              id: generateId(),
              method: "transfer",
              amountCents: input.transferCents ?? 0,
              comment,
              editedByName: name,
              editedAt: at,
              voidedByName: null,
              voidedAt: null,
            },
          ]
        : [];

      await cash.replaceMovementGroup(
        restaurantId,
        group.first.id,
        group.first.groupId,
        { method: firstMethod, amountCents: firstAmount, comment, editedByName: name, editedAt: at },
        extraRows,
      );
    },

    async voidMovement(restaurantId: string, member: MemberContext, movementId: string) {
      await assertPlan(restaurantId);
      const session = await openSession(restaurantId);
      const group = await cash.findMovementGroup(restaurantId, movementId);
      if (!group) throw new CashMovementNotFoundError();
      if (group.first.sessionId !== session.id) throw new CashSessionClosedError();
      if (group.first.kind === "order_split_income" || group.first.voidedAt) throw new MovementLockedError();
      const name = await memberName(members, restaurantId, member.memberId);
      await cash.voidMovementGroup(restaurantId, group.first.groupId, name, now());
    },

    async settle(restaurantId: string, member: MemberContext, input: SettleOrdersInput) {
      await assertPlan(restaurantId);
      const session = await openSession(restaurantId);
      const details = await Promise.all(input.orderIds.map((id) => orders.findDetail(restaurantId, id)));
      const valid: OrderDetail[] = [];
      for (const order of details) {
        if (!order || order.status !== "delivered") {
          throw new ValidationError("orderIds: elegí pedidos entregados de tu local");
        }
        if (order.paymentStatus !== "paid" || (order.paymentMethod !== "cash" && order.paymentMethod !== "split")) {
          throw new ValidationError("orderIds: solo se ingresan envíos cobrados en efectivo o divididos");
        }
        if (order.settledAt !== null) {
          throw new ValidationError("orderIds: ese pedido ya está ingresado a la caja");
        }
        valid.push(order);
      }

      const name = await memberName(members, restaurantId, member.memberId);
      const at = now();
      const rows: NewMovementRow[] = [];
      for (const order of valid) {
        if (order.paymentMethod === "split") {
          rows.push(...buildOrderSplitIncomeRows(order, restaurantId, session.id, member, name, at, generateId));
        }
      }
      if ((input.changeBackCents ?? 0) > 0) {
        const courier = valid.find((order) => order.courier)?.courier ?? null;
        if (!courier) throw new ValidationError("Para registrar la vuelta de cambio, el pedido tiene que tener repartidor");
        rows.push({
          id: generateId(),
          groupId: generateId(),
          restaurantId,
          sessionId: session.id,
          kind: "courier_change_back",
          method: "cash",
          amountCents: input.changeBackCents!,
          comment: `Vuelve cambio ${courier.firstName} ${courier.lastName}`.trim(),
          orderId: null,
          courierMemberId: courier.memberId,
          createdAt: at,
          createdByMemberId: member.memberId,
          createdByName: name,
        });
      }

      await cash.settleOrders(
        restaurantId,
        session.id,
        valid.map((order) => order.id),
        at,
        member.memberId,
        rows,
      );
    },

    async unsettle(restaurantId: string, orderId: string) {
      await assertPlan(restaurantId);
      const order = await orders.findDetail(restaurantId, orderId);
      if (!order) throw new OrderNotFoundError();
      if (!order.cashSessionId || order.settledAt === null) {
        throw new ValidationError("El pedido no está ingresado a la caja");
      }
      const session = await cash.findSession(restaurantId, order.cashSessionId);
      if (!session || session.closedAt) throw new CashSessionClosedError();
      await cash.unsettleOrder(restaurantId, session.id, orderId, new Date(order.settledAt));
    },

    async giveChange(restaurantId: string, member: MemberContext, input: GiveCourierChangeInput) {
      await assertPlan(restaurantId);
      const session = await openSession(restaurantId);
      const record = await members.find(restaurantId, input.courierMemberId);
      if (!record || !record.member.active || !record.member.isCourier) {
        throw new ValidationError("courierMemberId: elegí un repartidor activo de tu local");
      }
      const name = await memberName(members, restaurantId, member.memberId);
      await cash.insertMovements([
        {
          id: generateId(),
          groupId: generateId(),
          restaurantId,
          sessionId: session.id,
          kind: "courier_change_out",
          method: "cash",
          amountCents: input.amountCents,
          comment: `Cambio a ${record.member.firstName} ${record.member.lastName}`.trim(),
          courierMemberId: record.member.id,
          createdAt: now(),
          createdByMemberId: member.memberId,
          createdByName: name,
        },
      ]);
    },

    async close(restaurantId: string, member: MemberContext, input: CloseCashSessionInput): Promise<CashCloseResult> {
      await assertPlan(restaurantId);
      const session = await openSession(restaurantId);
      const name = await memberName(members, restaurantId, member.memberId);
      const closed = await cash.closeSession(restaurantId, session.id, {
        countedCashCents: input.countedCashCents,
        closeNote: input.note?.trim() ? input.note.trim() : null,
        closedByMemberId: member.memberId,
        closedByName: name,
        at: now(),
      });
      if (!closed) throw new NoOpenCashSessionError();
      const pendingRecords = await cash.listToSettle(restaurantId);
      const pendingGroups = toSettlementGroups(pendingRecords, [], new Map());
      return {
        detail: await detail(restaurantId, session.id),
        pending: {
          count: pendingRecords.length,
          totalCents: pendingGroups.reduce((sum, group) => sum + group.ordersCents, 0),
          couriers: [
            ...new Set(
              pendingGroups
                .map((group) => (group.courier ? `${group.courier.firstName} ${group.courier.lastName}`.trim() : ""))
                .filter(Boolean),
            ),
          ],
        },
      };
    },

    async history(restaurantId: string, query: CashHistoryQuery): Promise<CashHistory> {
      await assertPlan(restaurantId);
      const { sessions, total } = await cash.listClosed(restaurantId, query.page, query.limit);
      return {
        sessions: sessions.map(toCashSession),
        page: query.page,
        limit: query.limit,
        total,
      };
    },
  };
}

export type CashService = ReturnType<typeof createCashService>;

export function cashServiceFor(db: D1Database): CashService {
  return createCashService({
    cash: createCashRepository(db),
    orders: createOrdersRepository(db),
    members: createMembersRepository(db),
    restaurants: createRestaurantsRepository(db),
    hours: createHoursRepository(db),
  });
}
