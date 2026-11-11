import { describe, expect, it } from "vitest";
import {
  CUSTOMER_IMPORT_MAX_ROWS,
  customerCsvTemplate,
  customerImportErrorsCsv,
  customerListQuerySchema,
  customerPhoneSearchDigits,
  parseCustomersCsv,
} from "./customers";

describe("customerListQuerySchema", () => {
  it("defaults to the first page ordered by orders desc", () => {
    expect(customerListQuerySchema.parse({})).toEqual({ sort: "orders", dir: "desc", page: 1 });
  });

  it("reads every filter and the page", () => {
    expect(
      customerListQuerySchema.parse({
        q: "  juan ",
        from: "2026-10-01",
        to: "2026-10-31",
        product: "p1",
        tag: "t1",
        sort: "spent",
        dir: "asc",
        page: "3",
      }),
    ).toEqual({
      q: "juan",
      from: "2026-10-01",
      to: "2026-10-31",
      product: "p1",
      tag: "t1",
      sort: "spent",
      dir: "asc",
      page: 3,
    });
  });

  it("treats empty parameters as absent", () => {
    expect(customerListQuerySchema.parse({ q: "", from: "", sort: "" })).toEqual({ sort: "orders", dir: "desc", page: 1 });
  });

  it("rejects bad dates, a reversed range, an unknown sort and page 0", () => {
    expect(customerListQuerySchema.safeParse({ from: "2026-02-31" }).success).toBe(false);
    expect(customerListQuerySchema.safeParse({ from: "2026-11-02", to: "2026-11-01" }).success).toBe(false);
    expect(customerListQuerySchema.safeParse({ sort: "phone" }).success).toBe(false);
    expect(customerListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });
});

describe("customerPhoneSearchDigits", () => {
  it.each([
    ["11 2267-9246", "1122679246"],
    ["1122679246", "1122679246"],
    ["5491122679246", "1122679246"],
    ["+54 9 11 2267-9246", "1122679246"],
    ["+54 9 11 15 2267-9246", "1122679246"],
    ["11 15 2267 9246", "1122679246"],
    ["2267-92", "226792"],
  ])("normalizes %s", (input, expected) => {
    expect(customerPhoneSearchDigits(input)).toBe(expected);
  });

  it("returns null with fewer than 6 digits", () => {
    expect(customerPhoneSearchDigits("12345")).toBeNull();
    expect(customerPhoneSearchDigits("Juan")).toBeNull();
  });
});

describe("parseCustomersCsv", () => {
  it("reads a semicolon file with a BOM and headers without accents", () => {
    const result = parseCustomersCsv(
      "\uFEFFNombre;Telefono;Direccion;Notas;Etiquetas\r\nJuan Pérez;11 2267-9246;Corrientes 1234;Timbre 2B;Casa|VIP\r\n",
    );
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          row: 2,
          name: "Juan Pérez",
          phone: "11 2267-9246",
          address: "Corrientes 1234",
          notes: "Timbre 2B",
          tags: ["Casa", "VIP"],
        },
      ],
    });
  });

  it("accepts comma files, quoted commas and columns in any order", () => {
    const result = parseCustomersCsv(
      'Etiquetas,Nombre,Teléfono,Notas,Dirección\n"Casa, VIP",Ana,11 5555-1234,"Sin\nservilletas",Calle 1\n',
    );
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          row: 2,
          name: "Ana",
          phone: "11 5555-1234",
          address: "Calle 1",
          notes: "Sin\nservilletas",
          tags: ["Casa", "VIP"],
        },
      ],
    });
  });

  it("skips blank rows and keeps the spreadsheet row of each error", () => {
    const result = parseCustomersCsv("\uFEFFNombre;Teléfono\n\nJuan;11 5555-1234\n;\nAna;11 5555-9999\n");
    expect(result.ok && result.rows.map((row) => [row.row, row.name])).toEqual([
      [3, "Juan"],
      [5, "Ana"],
    ]);
  });

  it("fails without the required headers", () => {
    expect(parseCustomersCsv("Nombre;Dirección\nJuan;Calle 1\n")).toEqual({
      ok: false,
      message: "El CSV necesita las columnas Nombre y Teléfono",
    });
  });

  it("rejects more than 1000 data rows before uploading", () => {
    const lines = ["Nombre;Teléfono"];
    for (let index = 0; index <= CUSTOMER_IMPORT_MAX_ROWS; index++) lines.push(`Cliente ${index};11 5555-0000`);
    const result = parseCustomersCsv(lines.join("\n"));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("1000");
  });

  it("rejects an empty file and an unterminated quote", () => {
    expect(parseCustomersCsv("  ").ok).toBe(false);
    expect(parseCustomersCsv('Nombre;Teléfono\n"Juan;11 5555-1234').ok).toBe(false);
  });
});

describe("CSV helpers", () => {
  it("downloads a model with the five columns", () => {
    expect(customerCsvTemplate()).toContain("Nombre;Teléfono;Dirección;Notas;Etiquetas");
  });

  it("writes the failed rows with their reason and escapes formulas", () => {
    const csv = customerImportErrorsCsv(
      [{ row: 3, name: "=SUM(1,2)", phone: "11 5555-1234", address: "", notes: "", tags: ["Casa"] }],
      [{ row: 3, message: "Teléfono inválido" }],
    );
    expect(csv).toContain("'=SUM(1,2)");
    expect(csv).toContain("Teléfono inválido");
  });
});
