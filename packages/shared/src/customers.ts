import { z } from "zod";
import { isCalendarDateKey } from "./time";
import { normalizeArWhatsapp } from "./restaurant";
import type { Fulfillment, PaymentMethod } from "./order";
import type { OrderStatus, PaymentStatus } from "./orders";

/** Customers section (change 17a): list, sheet, tags, heatmap and CSV import/export. */

export const CUSTOMER_PAGE_SIZE = 25;
export const CUSTOMER_HISTORY_PAGE_SIZE = 10;
export const CUSTOMER_IMPORT_MAX_ROWS = 1000;
export const CUSTOMER_IMPORT_BATCH_SIZE = 50;
export const CUSTOMER_TAG_NAME_MAX_LENGTH = 24;
export const CUSTOMER_NAME_MAX_LENGTH = 60;
export const CUSTOMER_NOTES_MAX_LENGTH = 1000;
export const CUSTOMER_ADDRESS_MAX_LENGTH = 200;

export const CUSTOMER_TAG_COLORS = ["orange", "blue", "green", "purple", "pink", "teal", "amber", "gray"] as const;
export type CustomerTagColor = (typeof CUSTOMER_TAG_COLORS)[number];

export const CUSTOMER_SORT_FIELDS = ["orders", "spent", "last", "name", "since"] as const;
export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

export const CUSTOMER_SORT_DIRS = ["asc", "desc"] as const;
export type CustomerSortDir = (typeof CUSTOMER_SORT_DIRS)[number];

export const CUSTOMER_WHATSAPP_SOURCES = ["web", "manual"] as const;
export type CustomerWhatsappSource = (typeof CUSTOMER_WHATSAPP_SOURCES)[number];

export const CUSTOMER_MESSAGES = {
  nameRequired: "Ingresá el nombre del cliente",
  nameTooLong: `El nombre puede tener hasta ${CUSTOMER_NAME_MAX_LENGTH} caracteres`,
  phoneRequired: "Ingresá el teléfono del cliente",
  phoneInvalid: "Teléfono inválido. Usá un número de Argentina, por ejemplo 11 2267-9246.",
  notesTooLong: `Las notas pueden tener hasta ${CUSTOMER_NOTES_MAX_LENGTH} caracteres`,
  tagNameRequired: "Ingresá el nombre de la etiqueta",
  tagNameTooLong: `La etiqueta puede tener hasta ${CUSTOMER_TAG_NAME_MAX_LENGTH} caracteres`,
  missing: "Cliente no encontrado",
  updateEmpty: "Enviá al menos un cambio",
  fromInvalid: "Fecha desde inválida",
  toInvalid: "Fecha hasta inválida",
  rangeInvalid: "Rango de fechas inválido",
  pageInvalid: "Página inválida",
  phoneInUse: (name: string) => `Ese teléfono ya es de ${name}`,
} as const;

const optionalParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const dateKeyParam = optionalParam(z.string().refine(isCalendarDateKey, CUSTOMER_MESSAGES.fromInvalid));

/** Query of `GET /api/customers` and `GET /api/customers/export.csv`. */
export const customerListQuerySchema = z
  .object({
    q: optionalParam(z.string().trim().max(100)),
    from: dateKeyParam,
    to: dateKeyParam,
    product: optionalParam(z.string().trim().min(1)),
    tag: optionalParam(z.string().trim().min(1)),
    sort: optionalParam(z.enum(CUSTOMER_SORT_FIELDS)).transform((value) => value ?? "orders"),
    dir: optionalParam(z.enum(CUSTOMER_SORT_DIRS)).transform((value) => value ?? "desc"),
    page: optionalParam(
      z.coerce.number(CUSTOMER_MESSAGES.pageInvalid).int(CUSTOMER_MESSAGES.pageInvalid).positive(CUSTOMER_MESSAGES.pageInvalid),
    ).transform((value) => value ?? 1),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: CUSTOMER_MESSAGES.rangeInvalid,
    path: ["to"],
  });

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

/** Query of `GET /api/customers/:id/orders`. */
export const customerHistoryQuerySchema = z.object({
  page: optionalParam(
    z.coerce.number(CUSTOMER_MESSAGES.pageInvalid).int(CUSTOMER_MESSAGES.pageInvalid).positive(CUSTOMER_MESSAGES.pageInvalid),
  ).transform((value) => value ?? 1),
});

/**
 * Digits a phone search looks for, or `null` when the text has fewer than 6 digits. Stored numbers
 * are `549` + 10 national digits, so the country code, the mobile `9` and the local `15` are removed
 * first: "549 11 15 2267-9246" and "11 2267-9246" both search for "1122679246".
 */
export function customerPhoneSearchDigits(text: string): string | null {
  let digits = text.replace(/\D/g, "");
  if (digits.startsWith("54")) digits = digits.slice(2);
  if (digits.startsWith("9")) digits = digits.slice(1);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 12) {
    const index = [2, 3, 4].find((i) => digits.slice(i, i + 2) === "15");
    if (index !== undefined) digits = digits.slice(0, index) + digits.slice(index + 2);
  }
  return digits.length >= 6 ? digits : null;
}

/** Display of a stored number: `+54 9 1122679246`. */
export function formatCustomerPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("549") ? `+54 9 ${digits.slice(3)}` : `+${digits}`;
}

/** WhatsApp chat link of a stored phone. */
export function customerWhatsappUrl(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

/** Google Maps search link of a geocoded address. */
export function customerMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export interface CustomerTag {
  id: string;
  name: string;
  color: CustomerTagColor;
}

export interface CustomerListItem {
  id: string;
  name: string;
  /** Stored as `549` + 10 digits. */
  phone: string;
  /** Latest saved address, the text-only one, or `null`. */
  address: string | null;
  /** Coordinates of the latest saved address; `null` when the address is text only. */
  addressLat: number | null;
  addressLng: number | null;
  /** Orders that are not cancelled. */
  orders: number;
  /** Delivered and paid orders. */
  spentCents: number;
  lastOrderAt: number | null;
  tags: CustomerTag[];
}

export interface CustomerList {
  items: CustomerListItem[];
  total: number;
  page: number;
}

export interface CustomerAddressItem {
  id: string;
  label: string | null;
  formattedAddress: string;
  lat: number;
  lng: number;
  lastUsedAt: number;
}

export interface CustomerDetail {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  whatsappOptInAt: number | null;
  whatsappOptInSource: CustomerWhatsappSource | null;
  whatsappOptOut: boolean;
  tags: CustomerTag[];
  addresses: CustomerAddressItem[];
  orders: number;
  spentCents: number;
  averageTicketCents: number | null;
  firstOrderAt: number | null;
  lastOrderAt: number | null;
}

export interface CustomerOrderItem {
  name: string;
  quantity: number;
}

export interface CustomerOrderRow {
  id: string;
  number: number;
  fulfillment: Fulfillment;
  createdAt: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  totalCents: number;
  /** Units of every line. */
  itemCount: number;
  /** First three product names. */
  items: CustomerOrderItem[];
}

export interface CustomerOrdersPage {
  items: CustomerOrderRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CustomerHeatmapPoint {
  lat: number;
  lng: number;
  weight: number;
}

export interface CustomersHeatmap {
  points: CustomerHeatmapPoint[];
  withoutAddress: number;
  total: number;
  /** Location of the store, for the "Tu local" pin. */
  store: { lat: number; lng: number } | null;
}

export interface CustomerImportRow {
  /** Spreadsheet row for the error file (header is row 1). */
  row: number;
  name: string;
  phone: string;
  address: string;
  notes: string;
  tags: string[];
}

export interface CustomerImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

/** Body of `POST /api/customers/import`: one batch of already parsed rows. */
export const customerImportRequestSchema = z.object({
  rows: z.array(
    z.object({
      row: z.number().int().positive(),
      name: z.string(),
      phone: z.string(),
      address: z.string().max(CUSTOMER_ADDRESS_MAX_LENGTH * 2).default(""),
      notes: z.string().max(CUSTOMER_NOTES_MAX_LENGTH * 2).default(""),
      tags: z.array(z.string()).max(30).default([]),
    }),
  ).min(1).max(CUSTOMER_IMPORT_BATCH_SIZE),
});

export type CustomerImportRequest = z.infer<typeof customerImportRequestSchema>;

const customerNameSchema = z
  .string(CUSTOMER_MESSAGES.nameRequired)
  .trim()
  .min(1, CUSTOMER_MESSAGES.nameRequired)
  .max(CUSTOMER_NAME_MAX_LENGTH, CUSTOMER_MESSAGES.nameTooLong);

const customerPhoneSchema = z
  .string(CUSTOMER_MESSAGES.phoneRequired)
  .trim()
  .min(1, CUSTOMER_MESSAGES.phoneRequired)
  .transform((value, ctx) => {
    const normalized = normalizeArWhatsapp(value);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: CUSTOMER_MESSAGES.phoneInvalid });
      return z.NEVER;
    }
    return normalized;
  });

const customerNotesSchema = z
  .string()
  .trim()
  .max(CUSTOMER_NOTES_MAX_LENGTH, CUSTOMER_MESSAGES.notesTooLong)
  .nullable()
  .transform((value) => (value ? value : null));

/** Body of `PATCH /api/customers/:id`: any subset of the keys, at least one. */
export const updateCustomerSchema = z
  .object({
    name: customerNameSchema.optional(),
    phone: customerPhoneSchema.optional(),
    notes: customerNotesSchema.optional(),
    whatsappOptOut: z.boolean().optional(),
    tagIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: CUSTOMER_MESSAGES.updateEmpty,
  });

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const customerTagInputSchema = z.object({
  name: z
    .string(CUSTOMER_MESSAGES.tagNameRequired)
    .trim()
    .min(1, CUSTOMER_MESSAGES.tagNameRequired)
    .max(CUSTOMER_TAG_NAME_MAX_LENGTH, CUSTOMER_MESSAGES.tagNameTooLong),
  color: z.enum(CUSTOMER_TAG_COLORS),
});

export type CustomerTagInput = z.infer<typeof customerTagInputSchema>;

/** Body of `PATCH /api/customer-tags/:id`: any subset. */
export const updateCustomerTagSchema = customerTagInputSchema
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: CUSTOMER_MESSAGES.updateEmpty,
  });

export type UpdateCustomerTagInput = z.infer<typeof updateCustomerTagSchema>;

// ---------------------------------------------------------------------------------------------
// CSV import (parsed in the browser, uploaded in batches)
// ---------------------------------------------------------------------------------------------

export const CUSTOMER_CSV_COLUMNS = ["Nombre", "Teléfono", "Dirección", "Notas", "Etiquetas"] as const;

export type ParsedCustomerCsvRow = CustomerImportRow;

export type ParseCustomersCsvResult =
  | { ok: true; rows: ParsedCustomerCsvRow[] }
  | { ok: false; message: string };

const CSV_HEADERS = {
  name: "nombre",
  phone: "telefono",
  address: "direccion",
  notes: "notas",
  tags: "etiquetas",
} as const;

export const CUSTOMER_CSV_MESSAGES = {
  empty: "El archivo está vacío",
  invalid: "El archivo no es un CSV válido",
  missingHeaders: "El CSV necesita las columnas Nombre y Teléfono",
  tooManyRows: `El CSV puede tener hasta ${CUSTOMER_IMPORT_MAX_ROWS} filas. Dividilo en varios archivos.`,
} as const;

const normalizeHeader = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

/** Picks `;` when the header has more semicolons than commas outside quotes (Excel in Spanish). */
function detectDelimiter(header: string): "," | ";" {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (const char of header) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") commas++;
    else if (!quoted && char === ";") semicolons++;
  }
  return semicolons > commas ? ";" : ",";
}

/** RFC-4180-ish parser: quoted cells, escaped quotes and line breaks inside quotes. */
function parseCsv(text: string, delimiter: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (quoted) return null;
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Reads the model CSV (columns in any order, headers without case or accents). */
export function parseCustomersCsv(input: string): ParseCustomersCsvResult {
  const text = input.replace(/^\uFEFF/, "");
  if (text.trim() === "") return { ok: false, message: CUSTOMER_CSV_MESSAGES.empty };

  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const rows = parseCsv(text, detectDelimiter(firstLine));
  if (!rows) return { ok: false, message: CUSTOMER_CSV_MESSAGES.invalid };

  const header = (rows[0] ?? []).map(normalizeHeader);
  const indexOf = (name: string) => header.indexOf(name);
  const indexes = {
    name: indexOf(CSV_HEADERS.name),
    phone: indexOf(CSV_HEADERS.phone),
    address: indexOf(CSV_HEADERS.address),
    notes: indexOf(CSV_HEADERS.notes),
    tags: indexOf(CSV_HEADERS.tags),
  };
  if (indexes.name < 0 || indexes.phone < 0) return { ok: false, message: CUSTOMER_CSV_MESSAGES.missingHeaders };

  const parsed: ParsedCustomerCsvRow[] = [];
  for (let index = 1; index < rows.length; index++) {
    const cells = rows[index]!;
    const valueAt = (position: number) => (position >= 0 ? (cells[position] ?? "").trim() : "");
    const name = valueAt(indexes.name);
    const phone = valueAt(indexes.phone);
    const address = valueAt(indexes.address);
    const notes = valueAt(indexes.notes);
    const tags = valueAt(indexes.tags)
      .split(/[|,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (!name && !phone && !address && !notes && tags.length === 0) continue;
    parsed.push({ row: index + 1, name, phone, address, notes, tags });
  }

  if (parsed.length > CUSTOMER_IMPORT_MAX_ROWS) return { ok: false, message: CUSTOMER_CSV_MESSAGES.tooManyRows };
  return { ok: true, rows: parsed };
}

/** The downloadable model, with a BOM so Excel reads the accents. */
export function customerCsvTemplate(): string {
  return `\uFEFF${CUSTOMER_CSV_COLUMNS.join(";")}\r\nJuan Pérez;11 2267-9246;Av. Corrientes 1234;Cliente de los viernes;Casa|VIP\r\n`;
}

/** CSV of the rows that failed the import, ready to download. */
export function customerImportErrorsCsv(rows: readonly CustomerImportRow[], errors: readonly { row: number; message: string }[]): string {
  const escape = (value: string) => {
    let text = value;
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const byRow = new Map(rows.map((row) => [row.row, row]));
  const header = ["Fila", "Nombre", "Teléfono", "Dirección", "Notas", "Etiquetas", "Motivo"];
  const lines = [header.join(";")];
  for (const error of errors) {
    const row = byRow.get(error.row);
    lines.push(
      [
        String(error.row),
        row?.name ?? "",
        row?.phone ?? "",
        row?.address ?? "",
        row?.notes ?? "",
        row?.tags.join("|") ?? "",
        error.message,
      ].map(escape).join(";"),
    );
  }
  return `\uFEFF${lines.join("\r\n")}`;
}
