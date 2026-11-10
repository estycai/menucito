import { describe, expect, it } from "vitest";
import { csvFileName, formatCount, formatMoney, toCsv } from "./reports";

describe("toCsv", () => {
  it("writes Spanish headers, semicolons, comma decimals and a BOM", () => {
    const csv = toCsv(
      [
        { method: "Efectivo", orders: 3, cents: 123450 },
        { method: "Transferencia; alias", orders: 1, cents: 100000 },
      ],
      [
        { header: "Medio", value: (row) => row.method },
        { header: "Pedidos", value: (row) => row.orders },
        { header: "Facturado", value: (row) => row.cents, money: true },
      ],
    );
    expect(csv).toBe(
      '\uFEFFMedio;Pedidos;Facturado\r\nEfectivo;3;1234,50\r\n"Transferencia; alias";1;1000,00',
    );
  });

  it("escapes quotes and builds the file name of the spec", () => {
    expect(toCsv([{ name: 'La "especial"' }], [{ header: "Producto", value: (row) => row.name }])).toBe(
      '\uFEFFProducto\r\n"La ""especial"""',
    );
    expect(csvFileName("evolution", "payment-methods", "2026-11-01", "2026-11-10")).toBe(
      "reportes-evolution-payment-methods-2026-11-01-2026-11-10.csv",
    );
  });
});

describe("money formatting", () => {
  it("shows Argentine amounts and counts", () => {
    expect(formatMoney(367_940_000)).toBe("$ 3.679.400");
    expect(formatCount(1234)).toBe("1.234");
  });
});

describe("toCsv percentages", () => {
  it("writes a decimal percentage with a comma", () => {
    const csv = toCsv([{ percent: 33.3 }], [{ header: "%", value: (row) => row.percent }]);
    expect(csv).toBe("﻿%\r\n33,3");
  });
});
