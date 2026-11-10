import { Suspense, lazy, type ReactNode } from "react";
import {
  ORDER_SOURCE_LABELS,
  PAYMENT_LABELS,
  type Access,
  type BillingOrdersBlock,
  type BillingPaymentBlock,
  type BillingPaymentRow,
  type BillingReport,
  type BillingSourceRow,
  type BillingTotalBlock,
  type ReportRange,
} from "@menucito/shared";
import { InfoHint } from "@/components/reports/InfoHint";
import { ReportEmpty, ReportNoBlocks } from "@/components/reports/ReportEmpty";
import { ReportTable, type ReportColumn } from "@/components/reports/ReportTable";
import { canExport, canSeeAmounts } from "@/lib/report-access";
import { formatCount, formatMoney, formatPercent } from "@/lib/reports";

const DonutChart = lazy(() => import("@/components/reports/EvolutionCharts").then((module) => ({ default: module.DonutChart })));

const MODALITY_LABELS = { delivery: "Delivery", takeaway: "Take away" } as const;

const TOTAL_HINT = "Suma del total de los pedidos entregados y pagados. Con pago dividido, cada parte suma a su medio.";
const SOURCE_NOTE = "Web = pedidos del menú público. Local y WhatsApp = pedidos cargados desde 'Nuevo pedido'.";
const TIPS_NOTE = "Las propinas existen solo en delivery pagado por transferencia.";

interface BillingTabProps {
  data: BillingReport;
  access: Access;
  canSeeDate?: boolean;
  onLast7Days?: () => void;
}

/** Facturación tab of Reports (change 16b). */
export function BillingTab({ data, access, canSeeDate = true, onLast7Days }: BillingTabProps) {
  const amounts = canSeeAmounts(access);
  const exportable = canExport(access);
  const { widgets, range } = data;
  if (!data.hasActivity) return <ReportEmpty range={range} canSeeDate={canSeeDate} onLast7Days={onLast7Days} />;
  if (!Object.values(widgets).some(Boolean)) return <ReportNoBlocks />;

  return (
    <div className="flex flex-col gap-4">
      {(widgets.total || widgets.orders_total) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {widgets.total && <TotalSummary block={widgets.total} amounts={amounts} />}
          {widgets.orders_total && <OrdersSummary block={widgets.orders_total} />}
        </div>
      )}
      {widgets.delivery && (
        <PaymentBlock
          title="Delivery por medio de pago"
          table={widgets.delivery}
          range={range}
          block="delivery"
          delivery
          amounts={amounts}
          exportable={exportable}
        />
      )}
      {widgets.takeaway && (
        <PaymentBlock
          title="Take away por medio de pago"
          table={widgets.takeaway}
          range={range}
          block="takeaway"
          amounts={amounts}
          exportable={exportable}
        />
      )}
      {widgets.source && <SourceBlock rows={widgets.source} range={range} amounts={amounts} exportable={exportable} />}
    </div>
  );
}

function SummarySection({ title, value, hint, children }: { title: string; value: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-white p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        {/* The (?) sits next to the heading, not inside it, so the heading reads only its title. */}
        <div className="flex items-center gap-2">
          <h2 className="m-0 font-display text-xl font-extrabold">{title}</h2>
          {hint && <InfoHint label={title}>{hint}</InfoHint>}
        </div>
        <b className="font-display text-[26px] leading-tight font-extrabold tabular-nums">{value}</b>
      </div>
      <div className="grid gap-4 sm:grid-cols-[180px_1fr] sm:items-center">{children}</div>
    </section>
  );
}

function DonutFallback() {
  return <div className="h-[220px] animate-pulse rounded-xl bg-bg" aria-hidden="true" />;
}

function TotalSummary({ block, amounts }: { block: BillingTotalBlock; amounts: boolean }) {
  const donut = block.rows.map((row) => ({
    name: PAYMENT_LABELS[row.method],
    value: amounts ? (row.billedCents ?? 0) : row.orders,
  }));
  return (
    <SummarySection
      title="Facturación total por medio"
      value={amounts ? formatMoney(block.billedCents ?? 0) : `${formatCount(block.orders)} pedidos`}
      hint={TOTAL_HINT}
    >
      <Suspense fallback={<DonutFallback />}>
        <DonutChart data={donut} money={amounts} label="Facturación por medio de pago" />
      </Suspense>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {block.rows.map((row) => (
          <li key={row.method} className="flex items-center justify-between gap-3 border-b border-line-soft pb-2 text-sm last:border-0">
            <span className="font-bold">{PAYMENT_LABELS[row.method]}</span>
            <span className="flex items-baseline gap-2 tabular-nums">
              {amounts && <span>{formatMoney(row.billedCents ?? 0)}</span>}
              <span className="text-muted">{formatPercent(row.percent)}</span>
            </span>
          </li>
        ))}
      </ul>
    </SummarySection>
  );
}

function OrdersSummary({ block }: { block: BillingOrdersBlock }) {
  const donut = block.rows.map((row) => ({ name: MODALITY_LABELS[row.fulfillment], value: row.orders }));
  return (
    <SummarySection title="Pedidos totales por modalidad" value={`${formatCount(block.orders)} pedidos`}>
      <Suspense fallback={<DonutFallback />}>
        <DonutChart data={donut} money={false} label="Pedidos por modalidad" />
      </Suspense>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {block.rows.map((row) => (
          <li key={row.fulfillment} className="flex items-center justify-between gap-3 border-b border-line-soft pb-2 text-sm last:border-0">
            <span className="font-bold">{MODALITY_LABELS[row.fulfillment]}</span>
            <span className="flex items-baseline gap-2 tabular-nums">
              <span>{formatCount(row.orders)}</span>
              <span className="text-muted">{formatPercent(row.percent)}</span>
            </span>
          </li>
        ))}
      </ul>
    </SummarySection>
  );
}

function PaymentBlock({
  title,
  table,
  range,
  block,
  delivery = false,
  amounts,
  exportable,
}: {
  title: string;
  table: BillingPaymentBlock;
  range: ReportRange;
  block: string;
  delivery?: boolean;
  amounts: boolean;
  exportable: boolean;
}) {
  const deliveryColumns: ReportColumn<BillingPaymentRow>[] = delivery
    ? [
        { key: "shipping", header: "Envío", kind: "money", value: (row) => row.shippingCents ?? 0 },
        { key: "tips", header: "Propinas", kind: "money", value: (row) => row.tipsCents ?? 0 },
      ]
    : [];
  const columns: ReportColumn<BillingPaymentRow>[] = [
    { key: "method", header: "Medio", kind: "text", value: (row) => (row.method ? PAYMENT_LABELS[row.method] : "Total") },
    { key: "orders", header: "Pedidos", kind: "count", value: (row) => row.orders },
    { key: "ticket", header: "Ticket prom.", kind: "money", value: (row) => row.ticketCents ?? 0 },
    { key: "products", header: "Productos + adicionales", kind: "money", value: (row) => row.productsCents ?? 0 },
    ...deliveryColumns,
    { key: "billed", header: "Facturado", kind: "money", value: (row) => row.billedCents ?? 0 },
  ];
  return (
    <ReportTable
      title={title}
      description={delivery ? TIPS_NOTE : undefined}
      rows={table.rows}
      columns={columns}
      rowKey={(row) => row.method ?? "total"}
      amounts={amounts}
      totalRow={table.total}
      export={{ tab: "facturacion", block, from: range.from, to: range.to, allowed: exportable }}
    />
  );
}

function SourceBlock({
  rows,
  range,
  amounts,
  exportable,
}: {
  rows: BillingSourceRow[];
  range: ReportRange;
  amounts: boolean;
  exportable: boolean;
}) {
  const columns: ReportColumn<BillingSourceRow>[] = [
    { key: "source", header: "Origen", kind: "text", value: (row) => ORDER_SOURCE_LABELS[row.source] },
    { key: "orders", header: "Pedidos", kind: "count", value: (row) => row.orders },
    { key: "ticket", header: "Ticket prom.", kind: "money", value: (row) => row.ticketCents ?? 0 },
    { key: "billed", header: "Facturado", kind: "money", value: (row) => row.billedCents ?? 0 },
    { key: "percent", header: "%", kind: "percent", value: (row) => row.percent },
  ];
  return (
    <ReportTable
      title="Por origen"
      description={SOURCE_NOTE}
      rows={rows}
      columns={columns}
      rowKey={(row) => row.source}
      amounts={amounts}
      export={{ tab: "facturacion", block: "source", from: range.from, to: range.to, allowed: exportable }}
    />
  );
}
