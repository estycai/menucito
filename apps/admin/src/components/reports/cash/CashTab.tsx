import { Link } from "react-router";
import {
  CASH_MOVEMENT_KIND_LABELS,
  formatCashDifference,
  formatLocalDateTime,
  formatLocalTime,
  type Access,
  type CashMethodReportRow,
  type CashMovementReportRow,
  type CashReport,
  type CashSessionReportRow,
  type CashShiftRow,
  type ReportRange,
} from "@menucito/shared";
import { KpiCard } from "@/components/reports/KpiCard";
import { ReportEmpty, ReportNoBlocks } from "@/components/reports/ReportEmpty";
import { ReportTable, type ReportColumn } from "@/components/reports/ReportTable";
import { canExport, canSeeAmounts, canSeeCashExpected } from "@/lib/report-access";
import { formatCount, formatMoney } from "@/lib/reports";
import { cn } from "@/lib/utils";

const METHOD_LABELS = { cash: "Efectivo", transfer: "Transferencia" } as const;

const SESSIONS_HINT = "Los arqueos entran por la fecha de apertura de la caja.";
const KPI_HINTS = {
  sessions: "Cajas abiertas en el período: cerradas y en curso.",
  sales: "Suma de las ventas cobradas en las cajas, sin las propinas.",
  income: "Ingresos cargados a mano y los de los pedidos divididos.",
  expense: "Egresos y pagos a repartidores de las cajas.",
  difference: "Diferencia de las cajas cerradas: contado − esperado.",
  balanced: "Cajas cerradas con diferencia 0.",
} as const;

interface CashTabProps {
  data: CashReport;
  access: Access;
  canSeeDate?: boolean;
  onLast7Days?: () => void;
  /** Re-reads only this tab (the open drawer is a photo of now). */
  onRefresh?: () => void;
  refreshing?: boolean;
}

/** Arqueos tab of Reports (change 16c). */
export function CashTab({ data, access, canSeeDate = true, onLast7Days, onRefresh, refreshing = false }: CashTabProps) {
  const amounts = canSeeAmounts(access);
  const seeExpected = canSeeCashExpected(access);
  const exportable = canExport(access);
  const { widgets, range } = data;
  if (!data.hasActivity) return <ReportEmpty range={range} canSeeDate={canSeeDate} onLast7Days={onLast7Days} kind="cash" />;
  if (!Object.values(widgets).some(Boolean)) return <ReportNoBlocks />;

  return (
    <div className="flex flex-col gap-4">
      {widgets.open && <OpenBlock open={widgets.open} amounts={amounts} onRefresh={onRefresh} refreshing={refreshing} />}
      {widgets.kpis && <KpisBlock kpis={widgets.kpis} amounts={amounts} seeExpected={seeExpected} />}
      {widgets.by_shift && (
        <ShiftBlock block={widgets.by_shift} range={range} amounts={amounts} seeExpected={seeExpected} exportable={exportable} />
      )}
      {widgets.by_method && (
        <MethodBlock block={widgets.by_method} range={range} amounts={amounts} exportable={exportable} />
      )}
      {widgets.movements && (
        <MovementsBlock rows={widgets.movements} range={range} amounts={amounts} exportable={exportable} />
      )}
      {widgets.sessions && (
        <SessionsBlock rows={widgets.sessions} range={range} amounts={amounts} seeExpected={seeExpected} exportable={exportable} />
      )}
    </div>
  );
}

function OpenBlock({
  open,
  amounts,
  onRefresh,
  refreshing,
}: {
  open: NonNullable<CashReport["widgets"]["open"]>;
  amounts: boolean;
  onRefresh?: () => void;
  refreshing: boolean;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-primary/30 bg-primary-soft p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="m-0 font-display text-xl font-extrabold">Caja abierta ahora</h2>
          <p className="m-0 text-[13px] text-muted">Una foto de ahora: no depende del rango de fechas.</p>
          <span className="text-[13px] text-muted">
            Por {open.openedByName} · {formatLocalDateTime(open.openedAt)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line bg-white px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? "Actualizando…" : "Actualizar"}
            </button>
          )}
          <Link
            to="/cajas"
            className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-bold text-white"
          >
            Ir a Cajas
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
        <div className="flex flex-col">
          <span className="text-xs font-bold tracking-wide text-muted uppercase">Efectivo</span>
          {amounts && open.cashCents !== undefined && <OpenRow label="Efectivo en caja" value={formatMoney(open.cashCents)} strong />}
          {amounts && open.openingCashCents !== undefined && <OpenRow label="Monto inicial" value={formatMoney(open.openingCashCents)} />}
          <OpenRow
            label={`Ventas (${formatCount(open.cashSalesCount)})`}
            value={amounts && open.cashSalesCents !== undefined ? formatMoney(open.cashSalesCents) : ""}
          />
          {amounts && (open.cashIncomeCents ?? 0) > 0 && (
            <OpenRow label="Ingresos" value={`+${formatMoney(open.cashIncomeCents ?? 0)}`} tone="success" />
          )}
          {amounts && (open.cashExpenseCents ?? 0) > 0 && (
            <OpenRow label="Egresos" value={`−${formatMoney(open.cashExpenseCents ?? 0)}`} tone="danger" />
          )}
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-bold tracking-wide text-muted uppercase">Transferencia</span>
          <OpenRow
            label={`Ventas (${formatCount(open.transferSalesCount)})`}
            value={amounts && open.transferSalesCents !== undefined ? formatMoney(open.transferSalesCents) : ""}
          />
        </div>
      </div>

      <div className="rounded-xl bg-white/70 p-3 text-sm">
        <b>
          En la calle:{" "}
          {amounts && open.onTheStreet.totalCents !== undefined ? formatMoney(open.onTheStreet.totalCents) : "—"}
        </b>{" "}
        (no cuenta).{" "}
        {amounts && (
          <span className="text-muted">
            Pedidos sin ingresar {formatMoney(open.onTheStreet.ordersCents ?? 0)} + cambio de repartidores{" "}
            {formatMoney(open.onTheStreet.changeCents ?? 0)}.
          </span>
        )}
      </div>
    </section>
  );
}

function OpenRow({ label, value, tone, strong }: { label: string; value: string; tone?: "success" | "danger"; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3 py-1 text-[15px]", strong && "font-extrabold")}>
      <span>{label}</span>
      <span
        className={cn(
          "tabular-nums whitespace-nowrap",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function KpisBlock({
  kpis,
  amounts,
  seeExpected,
}: {
  kpis: NonNullable<CashReport["widgets"]["kpis"]>;
  amounts: boolean;
  seeExpected: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
      <KpiCard
        label="Arqueos"
        value={formatCount(kpis.sessions)}
        hint={KPI_HINTS.sessions}
        secondary={`${formatCount(kpis.closed)} cerrados · ${formatCount(kpis.inProgress)} en curso`}
      />
      {amounts ? (
        <KpiCard
          label="Ventas de caja"
          value={formatMoney(kpis.salesCents ?? 0)}
          hint={KPI_HINTS.sales}
          secondary={`${formatCount(kpis.orders)} pedidos cobrados`}
        />
      ) : (
        <KpiCard
          label="Ventas de caja"
          value={`${formatCount(kpis.orders)} pedidos`}
          hint={KPI_HINTS.sales}
          secondary="Cobrados en las cajas"
        />
      )}
      {amounts && <KpiCard label="Ingresos" value={formatMoney(kpis.incomeCents ?? 0)} hint={KPI_HINTS.income} />}
      {amounts && <KpiCard label="Egresos" value={formatMoney(kpis.expenseCents ?? 0)} hint={KPI_HINTS.expense} />}
      {amounts && seeExpected && kpis.differenceCents !== undefined && (
        <KpiCard
          label="Diferencia de caja"
          value={formatCashDifference(kpis.differenceCents)}
          hint={KPI_HINTS.difference}
          secondary={`Esperado ${formatMoney(kpis.expectedCents ?? 0)} · Contado ${formatMoney(kpis.countedCents ?? 0)}`}
        />
      )}
      {seeExpected && kpis.balanced !== undefined && (
        <KpiCard
          label="Cuadraron justo"
          value={`${formatCount(kpis.balanced)} de ${formatCount(kpis.closed)}`}
          hint={KPI_HINTS.balanced}
          secondary="Arqueos cerrados"
        />
      )}
    </div>
  );
}

function ShiftBlock({
  block,
  range,
  amounts,
  seeExpected,
  exportable,
}: {
  block: NonNullable<CashReport["widgets"]["by_shift"]>;
  range: ReportRange;
  amounts: boolean;
  seeExpected: boolean;
  exportable: boolean;
}) {
  const columns: ReportColumn<CashShiftRow>[] = [
    { key: "label", header: "Turno", kind: "text", value: (row) => row.label },
    { key: "sessions", header: "Arqueos", kind: "count", value: (row) => row.sessions },
    { key: "orders", header: "Pedidos", kind: "count", value: (row) => row.orders },
    { key: "sales", header: "Ventas", kind: "money", value: (row) => row.salesCents ?? 0 },
    { key: "percent", header: "%", kind: "percent", value: (row) => row.percent },
    { key: "expense", header: "Egresos", kind: "money", value: (row) => row.expenseCents ?? 0 },
    ...(seeExpected
      ? [{ key: "difference", header: "Diferencia", kind: "money" as const, value: (row: CashShiftRow) => row.differenceCents ?? 0 }]
      : []),
  ];
  return (
    <ReportTable
      title="Por turno"
      description={SESSIONS_HINT}
      rows={block.rows}
      columns={columns}
      rowKey={(row) => row.shift || "total"}
      amounts={amounts}
      totalRow={block.total}
      export={{ tab: "arqueos", block: "by_shift", from: range.from, to: range.to, allowed: exportable }}
    />
  );
}

function MethodBlock({
  block,
  range,
  amounts,
  exportable,
}: {
  block: NonNullable<CashReport["widgets"]["by_method"]>;
  range: ReportRange;
  amounts: boolean;
  exportable: boolean;
}) {
  const columns: ReportColumn<CashMethodReportRow>[] = [
    {
      key: "method",
      header: "Medio",
      kind: "text",
      value: (row) => (row.method ? METHOD_LABELS[row.method] : "Total"),
    },
    { key: "orders", header: "Pedidos", kind: "count", value: (row) => row.orders },
    { key: "sales", header: "Ventas", kind: "money", value: (row) => row.salesCents ?? 0 },
    { key: "percent", header: "%", kind: "percent", value: (row) => row.percent },
    { key: "income", header: "Ingresos", kind: "money", value: (row) => row.incomeCents ?? 0 },
    { key: "expense", header: "Egresos", kind: "money", value: (row) => row.expenseCents ?? 0 },
  ];
  return (
    <ReportTable
      title="Por medio de pago"
      description="Las propinas van dentro de Transferencia, como en Cajas."
      rows={block.rows}
      columns={columns}
      rowKey={(row) => row.method ?? "total"}
      amounts={amounts}
      totalRow={block.total}
      export={{ tab: "arqueos", block: "by_method", from: range.from, to: range.to, allowed: exportable }}
    />
  );
}

function MovementsBlock({
  rows,
  range,
  amounts,
  exportable,
}: {
  rows: CashMovementReportRow[];
  range: ReportRange;
  amounts: boolean;
  exportable: boolean;
}) {
  const columns: ReportColumn<CashMovementReportRow>[] = [
    {
      key: "kind",
      header: "Tipo",
      kind: "text",
      value: (row) => CASH_MOVEMENT_KIND_LABELS[row.kind],
      render: (row) => (
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap",
            row.direction === "income" ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
          )}
        >
          {CASH_MOVEMENT_KIND_LABELS[row.kind]}
        </span>
      ),
    },
    { key: "concept", header: "Concepto", kind: "text", value: (row) => row.concept },
    { key: "count", header: "Cantidad", kind: "count", value: (row) => row.count },
    { key: "amount", header: "Monto", kind: "money", value: (row) => row.amountCents ?? 0 },
  ];
  return (
    <ReportTable
      title="Movimientos"
      description="Los cargados a mano, agrupados por tipo y concepto. Los anulados no cuentan."
      rows={rows}
      columns={columns}
      rowKey={(row) => `${row.kind}-${row.concept}`}
      amounts={amounts}
      export={{ tab: "arqueos", block: "movements", from: range.from, to: range.to, allowed: exportable }}
    />
  );
}

function SessionsBlock({
  rows,
  range,
  amounts,
  seeExpected,
  exportable,
}: {
  rows: CashSessionReportRow[];
  range: ReportRange;
  amounts: boolean;
  seeExpected: boolean;
  exportable: boolean;
}) {
  const columns: ReportColumn<CashSessionReportRow>[] = [
    {
      key: "date",
      header: "Fecha",
      kind: "text",
      // Sorted by the opening instant (two sessions of the same day keep their order), shown as the day.
      value: (row) => row.openedAt,
      format: (value) => formatLocalDateTime(Number(value)).slice(0, 10),
    },
    { key: "shift", header: "Turno", kind: "text", value: (row) => row.shiftLabel },
    { key: "opened", header: "Apertura", kind: "text", value: (row) => formatLocalTime(row.openedAt) },
    {
      key: "closed",
      header: "Cierre",
      kind: "text",
      value: (row) => (row.closedAt === null ? "En curso" : formatLocalTime(row.closedAt)),
      render: (row) =>
        row.closedAt === null ? (
          <span className="inline-flex rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold whitespace-nowrap text-success">
            En curso
          </span>
        ) : (
          formatLocalTime(row.closedAt)
        ),
    },
    { key: "openedBy", header: "Abrió", kind: "text", value: (row) => row.openedByName },
    { key: "closedBy", header: "Cerró", kind: "text", value: (row) => row.closedByName ?? "—" },
    { key: "orders", header: "Pedidos", kind: "count", value: (row) => row.orders },
    { key: "sales", header: "Ventas", kind: "money", value: (row) => row.salesCents ?? 0 },
    { key: "expense", header: "Egresos", kind: "money", value: (row) => row.expenseCents ?? 0 },
    ...(seeExpected && amounts
      ? ([
          { key: "expected", header: "Esperado", kind: "money", value: (row: CashSessionReportRow) => row.expectedCashCents ?? 0 },
          {
            key: "counted",
            header: "Contado",
            kind: "money",
            value: (row: CashSessionReportRow) => row.countedCashCents ?? "",
            render: (row) =>
              row.countedCashCents === undefined ? "—" : formatMoney(row.countedCashCents),
          },
          {
            key: "difference",
            header: "Diferencia",
            kind: "money",
            // A number so it sorts and exports as one; the session in progress has none.
            value: (row: CashSessionReportRow) => row.differenceCents ?? "",
            render: (row) => {
              if (row.differenceCents === undefined) return "—";
              return (
                <span
                  className={cn(
                    "font-bold",
                    row.differenceCents > 0 ? "text-success" : row.differenceCents < 0 ? "text-danger" : "text-muted",
                  )}
                >
                  {formatCashDifference(row.differenceCents)}
                </span>
              );
            },
          },
        ] satisfies ReportColumn<CashSessionReportRow>[])
      : []),
  ];
  return (
    <ReportTable
      title="Arqueos"
      description="Una fila por caja, la más nueva primero."
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      amounts={amounts}
      export={{ tab: "arqueos", block: "sessions", from: range.from, to: range.to, allowed: exportable }}
    />
  );
}
