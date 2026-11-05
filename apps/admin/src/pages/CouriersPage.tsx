import { useState } from "react";
import {
  COURIER_SUMMARY_STATUSES,
  COURIER_SUMMARY_STATUS_LABELS,
  formatArs,
  type CourierSummaryRow,
  type CourierSummaryStatus,
} from "@menucito/shared";
import { QueryError } from "@/components/QueryError";
import { Badge } from "@/components/ui/badge";
import {
  courierName,
  courierTotals,
  filterCourierRows,
  useCourierSummary,
} from "@/lib/couriers";
import { todayRange, type DateRange } from "@/lib/deliveries";
import { useDocumentTitle } from "@/lib/use-document-title";
import { cn } from "@/lib/utils";

const CONTROL_CLASS =
  "box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

const COURIERS_UI_MESSAGES = {
  loadFailed: "No pudimos cargar el resumen de repartidores.",
  empty: "No hay pedidos en ese rango.",
} as const;

/**
 * "Repartidores" (change 13, scenario 48): the daily summary by courier, with a courier filter and a
 * date range. The filter is applied on the loaded rows so its options survive a range change.
 */
export function CouriersPage() {
  useDocumentTitle("Repartidores");
  const [range, setRange] = useState<DateRange>(() => todayRange());
  const [courierId, setCourierId] = useState<string | null>(null);
  const [status, setStatus] = useState<CourierSummaryStatus>("delivered");
  const showDelivered = status !== "sent";
  const showInProgress = status !== "delivered";

  const summaryQuery = useCourierSummary(range.from, range.to, status);
  const summary = summaryQuery.data;
  const rows = summary ? filterCourierRows(summary.rows, courierId, summary.couriers) : [];
  const totals = courierTotals(rows);
  // Every courier of the local, not only the ones with deliveries in the range: the options of the
  // filter must survive a date change. "Sin repartidor" is a row, not a filter option.
  const options = summary?.couriers ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Repartidores</h1>
          <span className="text-sm text-muted">Pedidos entregados, envíos y propinas por repartidor.</span>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Estado
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as CourierSummaryStatus)}
              className={cn(CONTROL_CLASS, "sm:min-w-[150px]")}
            >
              {COURIER_SUMMARY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {COURIER_SUMMARY_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Repartidor
            <select
              value={courierId ?? ""}
              onChange={(event) => setCourierId(event.target.value || null)}
              className={cn(CONTROL_CLASS, "sm:min-w-[200px]")}
            >
              <option value="">Todos</option>
              {options.map((row) => (
                <option key={row.memberId} value={row.memberId}>
                  {courierName(row)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Desde
            <input
              type="date"
              value={range.from}
              onChange={(event) => event.target.value && setRange((prev) => ({ ...prev, from: event.target.value }))}
              className={CONTROL_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Hasta
            <input
              type="date"
              value={range.to}
              onChange={(event) => event.target.value && setRange((prev) => ({ ...prev, to: event.target.value }))}
              className={CONTROL_CLASS}
            />
          </label>
          <button
            type="button"
            onClick={() => setRange(todayRange())}
            className="box-border flex min-h-[44px] cursor-pointer items-center rounded-xl border-2 border-primary bg-primary-soft px-4 text-sm font-bold text-link focus-visible:outline-2 focus-visible:outline-primary"
          >
            Hoy
          </button>
        </div>
      </div>

      <section className={cn("grid grid-cols-1 gap-4", status === "all" ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3")}>
        {showDelivered && <TotalCard label="Entregados" value={String(totals.delivered)} loading={summaryQuery.isLoading} />}
        {showInProgress && <TotalCard label="En camino" value={String(totals.inProgress)} loading={summaryQuery.isLoading} />}
        <TotalCard label="Envíos" value={formatArs(totals.shippingCents)} loading={summaryQuery.isLoading} />
        <TotalCard label="Propinas" value={formatArs(totals.tipCents)} tone="success" loading={summaryQuery.isLoading} />
      </section>

      {summaryQuery.isError ? (
        <QueryError message={COURIERS_UI_MESSAGES.loadFailed} onRetry={() => void summaryQuery.refetch()} />
      ) : summaryQuery.isLoading ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">Cargando el resumen...</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">{COURIERS_UI_MESSAGES.empty}</div>
      ) : (
        <>
          {/* Desktop Table (from 768px) */}
          <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white md:block">
            <table className="w-full border-collapse text-left text-[15px]">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="px-4 py-3.5 font-bold">Repartidor</th>
                  {showDelivered && <th className="px-4 py-3.5 text-right font-bold">Entregados</th>}
                  {showInProgress && <th className="px-4 py-3.5 text-right font-bold">En camino</th>}
                  <th className="px-4 py-3.5 text-right font-bold">Envíos</th>
                  <th className="px-4 py-3.5 text-right font-bold">Propinas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.memberId ?? "none"}>
                    <td className={cn("px-4 py-3.5", row.memberId === null ? "text-muted" : "font-bold")}>
                      <CourierLabel row={row} />
                    </td>
                    {showDelivered && <td className="px-4 py-3.5 text-right tabular-nums">{row.delivered}</td>}
                    {showInProgress && <td className="px-4 py-3.5 text-right tabular-nums">{row.inProgress}</td>}
                    <td className="px-4 py-3.5 text-right tabular-nums">{formatArs(row.shippingCents)}</td>
                    <td className="px-4 py-3.5 text-right tabular-nums">{formatArs(row.tipCents)}</td>
                  </tr>
                ))}
                <tr className="bg-bg">
                  <td className="px-4 py-3.5 font-extrabold">Total</td>
                  {showDelivered && <td className="px-4 py-3.5 text-right font-extrabold tabular-nums">{totals.delivered}</td>}
                  {showInProgress && <td className="px-4 py-3.5 text-right font-extrabold tabular-nums">{totals.inProgress}</td>}
                  <td className="px-4 py-3.5 text-right font-extrabold tabular-nums">{formatArs(totals.shippingCents)}</td>
                  <td className="px-4 py-3.5 text-right font-extrabold tabular-nums">{formatArs(totals.tipCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mobile Cards (under 768px) */}
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <article key={row.memberId ?? "none"} className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
                <span className={cn("font-display text-lg font-extrabold", row.memberId === null && "text-muted")}>
                  <CourierLabel row={row} />
                </span>
                <div className={cn("grid gap-2", status === "all" ? "grid-cols-4" : "grid-cols-3")}>
                  {showDelivered && <SummaryNumber label="Entregados" value={String(row.delivered)} />}
                  {showInProgress && <SummaryNumber label="En camino" value={String(row.inProgress)} />}
                  <SummaryNumber label="Envíos" value={formatArs(row.shippingCents)} />
                  <SummaryNumber label="Propinas" value={formatArs(row.tipCents)} />
                </div>
              </article>
            ))}
            <article className="flex items-center justify-between rounded-2xl border border-line bg-bg p-4">
              <span className="font-display text-lg font-extrabold">Total</span>
              <div className={cn("grid gap-2", status === "all" ? "grid-cols-4" : "grid-cols-3")}>
                {showDelivered && <SummaryNumber label="Entregados" value={String(totals.delivered)} />}
                {showInProgress && <SummaryNumber label="En camino" value={String(totals.inProgress)} />}
                <SummaryNumber label="Envíos" value={formatArs(totals.shippingCents)} />
                <SummaryNumber label="Propinas" value={formatArs(totals.tipCents)} />
              </div>
            </article>
          </div>
        </>
      )}

      <p className="m-0 text-[13px] text-muted">
        Con un repartidor elegido, la tabla y los totales muestran solo los suyos. Los entregados cuentan según la hora en que
        se marcaron entregados y los que están en camino según la hora en que salieron. Los cancelados no suman. Para un turno que pasa la medianoche, elegí desde hoy hasta mañana.
      </p>
    </div>
  );
}

/** Courier name plus the "Inactivo" pill of a deactivated courier (design "Repartidores"). */
function CourierLabel({ row }: { row: CourierSummaryRow }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {courierName(row)}
      {row.active === false && <Badge tone="subtle">Inactivo</Badge>}
    </span>
  );
}

function TotalCard({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: string;
  tone?: "success";
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-line bg-white p-5">
      <span className="text-sm text-muted">{label}</span>
      <span className={cn("font-display text-[32px] font-extrabold", tone === "success" && "text-success")}>
        {loading ? "—" : value}
      </span>
    </div>
  );
}

function SummaryNumber({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="font-display text-lg font-extrabold">{value}</span>
    </span>
  );
}
