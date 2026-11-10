/** Columns of the report tables (components/reports/ReportTable.tsx) and their pure ordering. */

export type ReportColumnKind = "text" | "count" | "money" | "percent";

export interface ReportSortableColumn<T> {
  key: string;
  kind: ReportColumnKind;
  value: (row: T) => string | number;
}

export type ReportSortDirection = "asc" | "desc";

export interface ReportSort {
  key: string;
  direction: ReportSortDirection;
}

/** Rows ordered by `sort`; the same direction sorts numbers and text (accent-insensitive). */
export function sortReportRows<T>(
  rows: readonly T[],
  columns: readonly ReportSortableColumn<T>[],
  sort: ReportSort | null,
): T[] {
  const column = sort ? columns.find((candidate) => candidate.key === sort.key) : undefined;
  if (!sort || !column) return [...rows];
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = column.value(a);
    const right = column.value(b);
    // An empty value (no data, e.g. a time without Enviado or a session in progress) always goes last.
    if (left === "" || right === "") return left === right ? 0 : left === "" ? 1 : -1;
    const result =
      typeof left === "string" || typeof right === "string"
        ? String(left).localeCompare(String(right), "es", { sensitivity: "base" })
        : left - right;
    return result * factor;
  });
}

/**
 * The sort after tapping a header: numbers start from the biggest (who sells the most) and text from
 * A; tapping the same header again flips it.
 */
export function nextSort(current: ReportSort | null, key: string, kind: ReportColumnKind): ReportSort {
  if (current?.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  return { key, direction: kind === "text" ? "asc" : "desc" };
}
