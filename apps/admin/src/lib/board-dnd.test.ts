import { describe, expect, it } from "vitest";
import type { Active, Over } from "@dnd-kit/core";
import type { OrderSummary } from "@menucito/shared";
import { arrowStep, boardAnnouncements, isClickGuarded } from "./board-dnd";

describe("isClickGuarded", () => {
  it("ignores clicks during a keyboard drag", () => {
    expect(isClickGuarded(true, 0, 1000)).toBe(true);
  });

  it("ignores clicks for a short window after a keyboard drop, then lets them through", () => {
    expect(isClickGuarded(false, 1400, 1000)).toBe(true);
    expect(isClickGuarded(false, 1400, 1400)).toBe(false);
    expect(isClickGuarded(false, 0, 1000)).toBe(false);
  });
});

describe("arrowStep", () => {
  it("maps right/down forward and left/up backward", () => {
    expect(arrowStep("ArrowRight")).toBe(1);
    expect(arrowStep("ArrowDown")).toBe(1);
    expect(arrowStep("ArrowLeft")).toBe(-1);
    expect(arrowStep("ArrowUp")).toBe(-1);
    expect(arrowStep("Space")).toBeUndefined();
  });
});

describe("boardAnnouncements", () => {
  const order = { id: "o1", number: 7, status: "new" } as OrderSummary;
  const announce = boardAnnouncements((id) => (id === order.id ? order : undefined));
  const active = { id: "o1" } as Active;
  const over = (id: string) => ({ id }) as Over;

  it("names the order and the column it is over", () => {
    expect(announce.onDragStart({ active })).toBe("Tomaste el pedido #7.");
    expect(announce.onDragOver?.({ active, over: over("preparing") })).toBe("Pedido #7 sobre En preparación.");
    expect(announce.onDragOver?.({ active, over: null })).toBe("Pedido #7 fuera de las columnas.");
  });

  it("warns when the column is not a valid target", () => {
    expect(announce.onDragOver?.({ active, over: over("new") })).toBe("Pedido #7 sobre Nuevo. No se puede mover ahí.");
  });

  it("says whether the drop changed the status", () => {
    expect(announce.onDragEnd({ active, over: over("ready") })).toBe("Soltaste el pedido #7 en Listo.");
    expect(announce.onDragEnd({ active, over: over("new") })).toBe("Soltaste el pedido #7. No cambió de estado.");
  });
});
