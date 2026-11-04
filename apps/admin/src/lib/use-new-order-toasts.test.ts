import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { toast } from "sonner";
import type { OrderSummary } from "@menucito/shared";
import { ACTIVE_ORDERS_KEY, ACTIVE_ORDERS_FILTERS, ORDERS_POLL_MS, ordersQueryOptions, type OrdersPage } from "./orders";
import { createNewOrderNotifier } from "./use-new-order-toasts";

// TanStack Query never polls on the server (no `window`); give it one so the 30 s interval runs.
vi.hoisted(() => {
  (globalThis as { window?: unknown }).window ??= {};
});

vi.mock("sonner", () => ({ toast: vi.fn() }));

// What the API answers to the active orders poll; each test edits it between polls.
let serverOrders: OrderSummary[] = [];
vi.mock("./restaurant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./restaurant")>()),
  api: vi.fn(async () => ({ orders: serverOrders, nextBefore: null })),
}));

const order = (id: string, number: number) =>
  ({ id, number, status: "new", customerName: "Juan", fulfillment: "delivery", totalCents: 100_000 }) as OrderSummary;

/**
 * The shell's polling without React: the same query (key, fetch, 30 s interval) observed by a
 * QueryObserver, each result handed to the notifier as the hook's effect does.
 */
function pollActiveOrders(restaurantId = "r1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const notify = createNewOrderNotifier();
  const openOrders = vi.fn();
  const observer = new QueryObserver(client, ordersQueryOptions(ACTIVE_ORDERS_FILTERS));
  let lastData: OrdersPage | undefined;
  const unsubscribe = observer.subscribe((result) => {
    if (!result.data || result.data === lastData) return;
    lastData = result.data;
    notify(restaurantId, result.data.orders, openOrders);
  });
  return { client, notify, openOrders, unsubscribe };
}

describe("new order toasts (spec 11b, scenarios 19 and 20)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(toast).mockClear();
    serverOrders = [order("a", 1)];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays quiet on the first load, shows one toast for two new orders and none after a rollback", async () => {
    const { client, openOrders, unsubscribe } = pollActiveOrders();

    // First load: what is already there is not new.
    await vi.advanceTimersByTimeAsync(0);
    expect(toast).not.toHaveBeenCalled();

    // Two orders arrive before the next poll: a single summary toast.
    serverOrders = [order("c", 3), order("b", 2), order("a", 1)];
    await vi.advanceTimersByTimeAsync(ORDERS_POLL_MS);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Llegaron 2 pedidos nuevos", expect.objectContaining({ description: undefined }));

    // "Ver pedidos" opens the board.
    const [, options] = vi.mocked(toast).mock.calls[0]!;
    (options!.action as unknown as { onClick: () => void }).onClick();
    expect(openOrders).toHaveBeenCalledWith({ showActiveOrders: true });

    // An optimistic move takes "c" off the list and a failure puts it back: not a new order.
    const page = client.getQueryData<OrdersPage>(ACTIVE_ORDERS_KEY)!;
    client.setQueryData<OrdersPage>(ACTIVE_ORDERS_KEY, { ...page, orders: page.orders.filter((o) => o.id !== "c") });
    client.setQueryData<OrdersPage>(ACTIVE_ORDERS_KEY, page);
    await vi.advanceTimersByTimeAsync(ORDERS_POLL_MS);
    expect(toast).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("starts over for another restaurant: its first result announces nothing", () => {
    const notify = createNewOrderNotifier();
    notify("r1", [order("a", 1)], vi.fn());
    notify("r2", [order("x", 9), order("y", 8)], vi.fn());
    expect(toast).not.toHaveBeenCalled();

    notify("r2", [order("z", 10), order("x", 9), order("y", 8)], vi.fn());
    expect(toast).toHaveBeenCalledWith("Nuevo pedido #10", expect.anything());
  });
});
