import { describe, expect, it } from "vitest";
import { ApiError, RESTAURANT_KEY } from "./restaurant";
import { createQueryClient, isUnauthorizedError } from "./query-client";
import { ACTIVE_ORDERS_KEY, DELIVERED_TODAY_KEY, ORDERS_KEY } from "./orders";
import { SESSION_KEY, clearSession } from "./session";

describe("isUnauthorizedError", () => {
  it("is true only for an API 401", () => {
    expect(isUnauthorizedError(new ApiError(401, "UNAUTHORIZED", "x"))).toBe(true);
    expect(isUnauthorizedError(new ApiError(403, "FORBIDDEN", "x"))).toBe(false);
    expect(isUnauthorizedError(new Error("network"))).toBe(false);
  });
});

describe("createQueryClient", () => {
  const session = { user: { id: "u1" } };

  it("clears the session and the restaurant when a query answers 401", async () => {
    const client = createQueryClient();
    client.setQueryData(SESSION_KEY, session);
    client.setQueryData([...RESTAURANT_KEY, "u1"], { id: "r1" });

    await expect(
      client.fetchQuery({ queryKey: ["orders"], queryFn: () => Promise.reject(new ApiError(401, "UNAUTHORIZED", "x")) }),
    ).rejects.toThrow();

    expect(client.getQueryData(SESSION_KEY)).toBeNull();
    expect(client.getQueryData([...RESTAURANT_KEY, "u1"])).toBeUndefined();
  });

  it("clears the session when a mutation answers 401", async () => {
    const client = createQueryClient();
    client.setQueryData(SESSION_KEY, session);
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(new ApiError(401, "UNAUTHORIZED", "x")),
    });

    await expect(mutation.execute(undefined)).rejects.toThrow();
    expect(client.getQueryData(SESSION_KEY)).toBeNull();
  });

  it("keeps the session on any other error", async () => {
    const client = createQueryClient();
    client.setQueryData(SESSION_KEY, session);

    await expect(
      client.fetchQuery({ queryKey: ["orders"], queryFn: () => Promise.reject(new ApiError(500, "INTERNAL", "x")) }),
    ).rejects.toThrow();

    expect(client.getQueryData(SESSION_KEY)).toEqual(session);
  });
});

describe("clearSession", () => {
  it("drops every order list so the next account never sees them (spec 11b)", () => {
    const client = createQueryClient();
    const page = { orders: [{ id: "o1" }], nextBefore: null };
    client.setQueryData(ACTIVE_ORDERS_KEY, page);
    client.setQueryData(DELIVERED_TODAY_KEY, page);
    client.setQueryData([...ORDERS_KEY, "history", {}], { pages: [page], pageParams: [undefined] });

    clearSession(client);

    expect(client.getQueryCache().findAll({ queryKey: ORDERS_KEY })).toHaveLength(0);
    expect(client.getQueryData(SESSION_KEY)).toBeNull();
  });
});
