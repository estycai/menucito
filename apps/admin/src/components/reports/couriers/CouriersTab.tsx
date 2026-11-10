import type {
  Access,
  CouriersCourierRow,
  CouriersReport,
  CouriersZoneRow,
  ReportRange,
} from "@menucito/shared";
import { KpiCard } from "@/components/reports/KpiCard";
import { ReportEmpty, ReportNoBlocks } from "@/components/reports/ReportEmpty";
import { ReportTable, type ReportColumn } from "@/components/reports/ReportTable";
import { canExport, canSeeAmounts } from "@/lib/report-access";
import { formatCount, formatDecimal, formatMoney } from "@/lib/reports";

const ORDERS_HINT = "Pedidos delivery entregados y pagados con repartidor asignado.";
const SHIPPING_HINT = "Suma del costo de envío de esos pedidos.";
const TIPS_HINT = "Suma de las propinas: solo existen en delivery pagado por transferencia.";
const TIME_HINT = "Promedio de minutos entre Enviado y Entregado.";
const CASH_HINT = "Efectivo rendido = efectivo de los pedidos que el repartidor ingresó a la caja.";

const minutesText = (value: number | null) => (value === null ? "—" : `${formatDecimal(value)} min`);
const kilometresText = (value: number | null) => (value === null ? "—" : `${formatDecimal(value)} km`);

interface CouriersTabProps {
  data: CouriersReport;
  access: Access;
  canSeeDate?: boolean;
  onLast7Days?: () => void;
}

/** Repartidores tab of Reports (change 16c). */
export function CouriersTab({ data, access, canSeeDate = true, onLast7Days }: CouriersTabProps) {
  const amounts = canSeeAmounts(access);
  const exportable = canExport(access);
  const { widgets, range } = data;
  if (!data.hasActivity) return <ReportEmpty range={range} canSeeDate={canSeeDate} onLast7Days={onLast7Days} kind="couriers" />;
  if (!Object.values(widgets).some(Boolean)) return <ReportNoBlocks />;

  const showShipping = amounts && widgets.shipping;
  const showTips = amounts && widgets.tips;
  const showKpis = widgets.orders || showShipping || showTips || widgets.time;

  return (
    <div className="flex flex-col gap-4">
      {showKpis && (
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
          {widgets.orders && (
            <KpiCard
              label="Envíos"
              value={formatCount(widgets.orders.current)}
              hint={ORDERS_HINT}
              change={widgets.orders.changePercent}
            />
          )}
          {showShipping && (
            <KpiCard
              label="Envíos cobrados"
              value={formatMoney(widgets.shipping?.currentCents ?? 0)}
              hint={SHIPPING_HINT}
              change={widgets.shipping?.changePercent}
            />
          )}
          {showTips && (
            <KpiCard
              label="Propinas"
              value={formatMoney(widgets.tips?.currentCents ?? 0)}
              hint={TIPS_HINT}
              change={widgets.tips?.changePercent}
            />
          )}
          {widgets.time && (
            <KpiCard
              label="Tiempo de entrega"
              value={widgets.time.currentMinutes === null ? "—" : `${formatDecimal(widgets.time.currentMinutes)} min`}
              hint={TIME_HINT}
              change={widgets.time.changePercent}
              invert
            />
          )}
        </div>
      )}

      {widgets.by_courier && (
        <CouriersBlock block={widgets.by_courier} range={range} amounts={amounts} exportable={exportable} />
      )}
      {widgets.by_zone && (
        <ZonesBlock block={widgets.by_zone} range={range} amounts={amounts} exportable={exportable} />
      )}
    </div>
  );
}

function CouriersBlock({
  block,
  range,
  amounts,
  exportable,
}: {
  block: NonNullable<CouriersReport["widgets"]["by_courier"]>;
  range: ReportRange;
  amounts: boolean;
  exportable: boolean;
}) {
  const columns: ReportColumn<CouriersCourierRow>[] = [
    { key: "name", header: "Repartidor", kind: "text", value: (row) => row.name },
    { key: "orders", header: "Envíos", kind: "count", value: (row) => row.orders },
    { key: "shipping", header: "Envío cobrado", kind: "money", value: (row) => row.shippingCents ?? 0 },
    { key: "tips", header: "Propinas", kind: "money", value: (row) => row.tipsCents ?? 0 },
    {
      key: "time",
      header: "Tiempo prom.",
      kind: "count",
      value: (row) => row.averageMinutes ?? "",
      format: (value) => minutesText(value === "" ? null : Number(value)),
    },
    { key: "cash", header: "Efectivo rendido", kind: "money", value: (row) => row.cashCents ?? 0 },
  ];
  return (
    <ReportTable
      title="Por repartidor"
      description={CASH_HINT}
      rows={block.rows}
      columns={columns}
      rowKey={(row) => row.memberId ?? "total"}
      amounts={amounts}
      totalRow={block.total}
      export={{ tab: "repartidores", block: "by_courier", from: range.from, to: range.to, allowed: exportable }}
    />
  );
}

function ZonesBlock({
  block,
  range,
  amounts,
  exportable,
}: {
  block: NonNullable<CouriersReport["widgets"]["by_zone"]>;
  range: ReportRange;
  amounts: boolean;
  exportable: boolean;
}) {
  const columns: ReportColumn<CouriersZoneRow>[] = [
    { key: "name", header: "Zona", kind: "text", value: (row) => row.name },
    { key: "orders", header: "Envíos", kind: "count", value: (row) => row.orders },
    { key: "shipping", header: "Envío cobrado", kind: "money", value: (row) => row.shippingCents ?? 0 },
    {
      key: "distance",
      header: "Distancia prom.",
      kind: "count",
      value: (row) => row.distanceKm ?? "",
      format: (value) => kilometresText(value === "" ? null : Number(value)),
    },
    {
      key: "time",
      header: "Tiempo prom.",
      kind: "count",
      value: (row) => row.averageMinutes ?? "",
      format: (value) => minutesText(value === "" ? null : Number(value)),
    },
  ];
  return (
    <ReportTable
      title="Envíos por zona"
      description="La zona es la que quedó guardada en el pedido: una zona borrada sigue apareciendo con su nombre."
      rows={block.rows}
      columns={columns}
      rowKey={(row) => `${row.zoneId ?? ""}-${row.name}`}
      amounts={amounts}
      totalRow={block.total}
      export={{ tab: "repartidores", block: "by_zone", from: range.from, to: range.to, allowed: exportable }}
    />
  );
}
