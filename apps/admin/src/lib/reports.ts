import { useQuery } from "@tanstack/react-query";
import type { BillingReport, CashReport, CouriersReport, EvolutionReport, ReportFilters, ReportMeta, SalesReport } from "@menucito/shared";
import { api } from "./restaurant";

export const REPORTS_KEY = ["reports"] as const;

/** Query string of the API (`from`, `to`, `shift`...), skipping empty filters. */
export function reportQueryString(filters: ReportFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export function useReportMeta(enabled = true) {
  return useQuery({
    queryKey: [...REPORTS_KEY, "meta"],
    queryFn: () => api<ReportMeta>("/api/reports/meta"),
    enabled,
    staleTime: 60_000,
  });
}

export function useEvolutionReport(filters: ReportFilters, enabled = true) {
  return useQuery({
    queryKey: [...REPORTS_KEY, "evolution", filters],
    queryFn: () => api<EvolutionReport>(`/api/reports/evolution?${reportQueryString(filters)}`),
    enabled,
    staleTime: 60_000,
  });
}

export function useBillingReport(filters: ReportFilters, enabled = true) {
  return useQuery({
    queryKey: [...REPORTS_KEY, "billing", filters],
    queryFn: () => api<BillingReport>(`/api/reports/billing?${reportQueryString(filters)}`),
    enabled,
    staleTime: 60_000,
  });
}

export function useSalesReport(filters: ReportFilters, enabled = true) {
  return useQuery({
    queryKey: [...REPORTS_KEY, "sales", filters],
    queryFn: () => api<SalesReport>(`/api/reports/sales?${reportQueryString(filters)}`),
    enabled,
    staleTime: 60_000,
  });
}

export function useCouriersReport(filters: ReportFilters, enabled = true) {
  return useQuery({
    queryKey: [...REPORTS_KEY, "couriers", filters],
    queryFn: () => api<CouriersReport>(`/api/reports/couriers?${reportQueryString(filters)}`),
    enabled,
    staleTime: 60_000,
  });
}

export function useCashReport(filters: ReportFilters, enabled = true) {
  return useQuery({
    queryKey: [...REPORTS_KEY, "cash", filters],
    queryFn: () => api<CashReport>(`/api/reports/cash?${reportQueryString(filters)}`),
    enabled,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------

export interface CsvColumn<T> {
  header: string;
  /** Numbers use a comma decimal (`33,3`), as Excel reads them in Spanish. */
  value: (row: T) => string | number;
  /** The value is in cents: written as whole pesos with a comma and two decimals (`1234,50`). */
  money?: boolean;
}

const cell = (value: string | number, money: boolean): string => {
  if (typeof value === "number") return money ? (value / 100).toFixed(2).replace(".", ",") : String(value).replace(".", ",");
  return value;
};

const escaped = (value: string): string =>
  /[";\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** CSV for Excel: `;` separator, Spanish headers, comma decimals and a UTF-8 BOM. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((column) => escaped(column.header)).join(";")];
  for (const row of rows) {
    lines.push(columns.map((column) => escaped(cell(column.value(row), column.money ?? false))).join(";"));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

/** `reportes-<pestaña>-<bloque>-<desde>-<hasta>.csv` */
export function csvFileName(tab: string, block: string, from: string, to: string): string {
  return `reportes-${tab}-${block}-${from}-${to}.csv`;
}

export function downloadCsv(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // Revoking right away can abort the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

const moneyFormat = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const numberFormat = new Intl.NumberFormat("es-AR");
const percentFormat = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const decimalFormat = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

/** "$ 3.679.400" */
export const formatMoney = (cents: number) => moneyFormat.format(cents / 100).replace(/\u00a0/g, " ");
export const formatCount = (value: number) => numberFormat.format(value);
export const formatPercent = (value: number) => `${percentFormat.format(value)}%`;
export const formatDecimal = (value: number) => decimalFormat.format(value);
export const formatChange = (value: number | null) =>
  value === null ? null : `${value > 0 ? "+" : ""}${percentFormat.format(value)}%`;
/** "$ 320.000" with a non-breaking space, so a chart axis keeps it on one line. */
export const formatAxisMoney = (cents: number) => formatMoney(cents).replace(" ", " ");
