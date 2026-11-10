import { useState, type ReactNode } from "react";
import { ExportButton } from "@/components/reports/ExportButton";
import { formatCount, formatMoney, formatPercent, type CsvColumn } from "@/lib/reports";
import { nextSort, sortReportRows, type ReportColumnKind, type ReportSort } from "@/lib/report-table";
import { cn } from "@/lib/utils";

export interface ReportColumn<T> {
  key: string;
  header: string;
  /** `money` columns are hidden without "Ver montos" and exported with two decimals. */
  kind: ReportColumnKind;
  value: (row: T) => string | number;
  /** Custom display of the value (minutes, kilometres, a dash for empty); the CSV uses it too. */
  format?: (value: string | number) => string;
  /** A cell drawn with markup instead of text (the "En curso" badge of the arqueos). */
  render?: (row: T) => ReactNode;
}

interface ReportExport {
  tab: string;
  block: string;
  from: string;
  to: string;
  allowed: boolean;
}

interface ReportTableProps<T> {
  /** The block's card: title and note on the left, Exportar on the right. */
  title: string;
  description?: string;
  /** Controls between the header and the table (a search box, a filter chip). */
  toolbar?: ReactNode;
  rows: readonly T[];
  columns: readonly ReportColumn<T>[];
  rowKey: (row: T) => string;
  amounts: boolean;
  /** A row always shown last, out of the sort; its first column usually says "Total". */
  totalRow?: T;
  export?: ReportExport;
  /** Pages of this size; the sort runs over every row, then the page is cut. */
  pageSize?: number;
  /** When it changes (a new search or category) the table goes back to the first page. */
  resetKey?: string;
  /** Makes the first cell a toggle button (the category filter of Ventas). */
  onRowClick?: (row: T) => void;
  isRowActive?: (row: T) => boolean;
  rowActionLabel?: (row: T, active: boolean) => string;
  emptyMessage?: string;
}

const cellText = <T,>(column: ReportColumn<T>, row: T): string => {
  const value = column.value(row);
  if (column.format) return column.format(value);
  if (column.kind === "money") return formatMoney(Number(value));
  if (column.kind === "count") return formatCount(Number(value));
  if (column.kind === "percent") return formatPercent(Number(value));
  return String(value);
};

const ALIGN: Record<ReportColumnKind, string> = {
  text: "text-left",
  count: "text-right",
  money: "text-right",
  percent: "text-right",
};

/** Table block shared by the Facturación and Ventas tabs: sort by header, optional total row, pages and CSV. */
export function ReportTable<T>({
  title,
  description,
  toolbar,
  rows,
  columns,
  rowKey,
  amounts,
  totalRow,
  export: exportOptions,
  pageSize,
  resetKey = "",
  onRowClick,
  isRowActive,
  rowActionLabel,
  emptyMessage = "Sin datos en el período.",
}: ReportTableProps<T>) {
  const [sort, setSort] = useState<ReportSort | null>(null);
  // The page belongs to one search: a new `resetKey` starts again from the first page.
  const [pageState, setPageState] = useState({ key: resetKey, page: 0 });
  const page = pageState.key === resetKey ? pageState.page : 0;
  const setPage = (next: number) => setPageState({ key: resetKey, page: next });

  const visible = columns.filter((column) => amounts || column.kind !== "money");
  const sorted = sortReportRows(rows, visible, sort);
  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const current = Math.min(page, pages - 1);
  const shown = pageSize ? sorted.slice(current * pageSize, (current + 1) * pageSize) : sorted;
  const csvColumns: CsvColumn<T>[] = visible.map((column) => ({
    header: column.header,
    value: (row) => (column.format ? column.format(column.value(row)) : column.value(row)),
    money: column.kind === "money",
  }));
  // The file is the table as seen: every row (not only the page), in the chosen order, with the total.
  const csvRows = totalRow ? [...sorted, totalRow] : sorted;

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="m-0 font-display text-xl font-extrabold">{title}</h2>
          {description && <p className="m-0 text-[13px] text-muted">{description}</p>}
        </div>
        {exportOptions?.allowed && (
          <ExportButton
            tab={exportOptions.tab}
            block={exportOptions.block}
            from={exportOptions.from}
            to={exportOptions.to}
            rows={csvRows}
            columns={csvColumns}
          />
        )}
      </div>
      {toolbar}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              {visible.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={sort?.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                  className={cn("px-3 py-1 font-bold", ALIGN[column.kind])}
                >
                  <button
                    type="button"
                    onClick={() => setSort((previous) => nextSort(previous, column.key, column.kind))}
                    className="inline-flex min-h-11 cursor-pointer items-center gap-1 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    {column.header}
                    {sort?.key === column.key && (
                      <span aria-hidden="true" className="text-[10px] text-ink">
                        {sort.direction === "desc" ? "▼" : "▲"}
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((row) => {
              const active = isRowActive?.(row) ?? false;
              return (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(onRowClick && "cursor-pointer hover:bg-bg", active && "bg-primary/10")}
                >
                  {visible.map((column, index) => (
                    <td
                      key={column.key}
                      className={cn(
                        "px-3 py-2 tabular-nums",
                        ALIGN[column.kind],
                        column.kind === "text" ? "font-bold" : "whitespace-nowrap",
                      )}
                    >
                      {index === 0 && onRowClick ? (
                        // The real control for keyboards and screen readers; the row click is a mouse shortcut.
                        <button
                          type="button"
                          aria-pressed={active}
                          aria-label={rowActionLabel?.(row, active)}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRowClick(row);
                          }}
                          className="-mx-1 min-h-11 cursor-pointer rounded-lg px-1 text-left font-bold focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          {cellText(column, row)}
                        </button>
                      ) : column.render ? (
                        column.render(row)
                      ) : (
                        cellText(column, row)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={visible.length} className="px-3 py-6 text-center text-muted">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {totalRow && (
              <tr className="border-t-2 border-line font-bold">
                {visible.map((column) => (
                  <td
                    key={column.key}
                    className={cn("px-3 py-2 tabular-nums", ALIGN[column.kind], column.kind !== "text" && "whitespace-nowrap")}
                  >
                    {column.render ? column.render(totalRow) : cellText(column, totalRow)}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pageSize && sorted.length > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>
            {current * pageSize + 1}–{Math.min((current + 1) * pageSize, sorted.length)} de {formatCount(sorted.length)}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              className="min-h-11 cursor-pointer rounded-xl border border-line px-3 text-xs font-bold text-ink disabled:cursor-not-allowed disabled:text-line-strong"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
              className="min-h-11 cursor-pointer rounded-xl border border-line px-3 text-xs font-bold text-ink disabled:cursor-not-allowed disabled:text-line-strong"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
