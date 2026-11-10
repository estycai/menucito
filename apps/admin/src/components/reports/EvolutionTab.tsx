import { lazy, Suspense, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  PAYMENT_LABELS,
  WEEKDAY_NAMES,
  localDateKey,
  type Access,
  type EvolutionReport,
} from "@menucito/shared";
import { ExportButton } from "@/components/reports/ExportButton";
import { KpiCard } from "@/components/reports/KpiCard";
import { canExport, canSeeAmounts } from "@/lib/report-access";
import {
  buildTrendSeries,
  type TrendComparison,
  type TrendGroup,
  type TrendMetric,
  type TrendView,
} from "@/lib/report-series";
import { formatCount, formatMoney, formatPercent } from "@/lib/reports";
import { cn } from "@/lib/utils";

const TrendChart = lazy(() => import("./EvolutionCharts").then((module) => ({ default: module.TrendChart })));
const DonutChart = lazy(() => import("./EvolutionCharts").then((module) => ({ default: module.DonutChart })));

const HINTS = {
  billed: "Suma del total de los pedidos entregados y pagados: productos − descuento + envío + propina.",
  orders: "Cantidad de pedidos entregados y pagados en el período.",
  ticket: "(productos − descuento) ÷ pedidos. No incluye envío ni propina.",
  shipping: "Suma del costo de envío de los pedidos entregados y pagados.",
  discounts: "Suma de los descuentos de los pedidos entregados y pagados.",
  cancellations: "Pedidos cancelados en el período: cantidad, plata perdida y porcentaje sobre ventas + cancelaciones.",
} as const;

const DAYS_FROM_MONDAY = [1, 2, 3, 4, 5, 6, 0] as const;

interface EvolutionTabProps {
  data: EvolutionReport;
  access: Access;
  onLast7Days: () => void;
  canSeeDate?: boolean;
}

/** The Evolución tab of Reports (change 16a): every block is clipped by the API and by `access`. */
export function EvolutionTab({ data, access, onLast7Days, canSeeDate = true }: EvolutionTabProps) {
  const widgets = data.widgets;
  const amounts = canSeeAmounts(access);
  const exportable = canExport(access);
  const [todayKey] = useState(() => localDateKey(Date.now()));
  if (!data.hasActivity) {
    const oneDay = data.range.from === data.range.to;
    const today = oneDay && data.range.from === todayKey;
    return (
      <section className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-white px-6 py-12 text-center">
        <h2 className="m-0 font-display text-xl font-extrabold">
          {today ? "Todavía no hay ventas hoy" : oneDay ? "No hubo ventas ese día" : "No hubo ventas en este período"}
        </h2>
        <p className="m-0 max-w-[440px] text-sm text-muted">
          Los pedidos entregados y pagados del período aparecen acá. Probá con más días o mirá los pedidos.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {canSeeDate && (
            <button
              type="button"
              onClick={onLast7Days}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-primary px-4 text-sm font-bold text-white"
            >
              Ver últimos 7 días
            </button>
          )}
          <Link
            to="/pedidos"
            className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-bold text-ink hover:bg-bg"
          >
            Ir a Pedidos
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <IndicatorGrid data={data} amounts={amounts} />
      {widgets.pnl && amounts && <PnlBlock data={data} />}
      {widgets.pace && <PaceBlock data={data} />}
      {widgets.trend && <TrendBlock data={data} amounts={amounts} />}
      {widgets.heatmap && <HeatmapBlock data={data} />}
      {widgets.movers && <MoversBlock data={data} />}
      {widgets.payment_methods && <PaymentMethodsBlock data={data} amounts={amounts} exportable={exportable} />}
      {widgets.customers && <CustomersBlock data={data} amounts={amounts} exportable={exportable} />}
    </div>
  );
}

function IndicatorGrid({ data, amounts }: { data: EvolutionReport; amounts: boolean }) {
  const widgets = data.widgets;
  const cards = [];
  if (widgets.billed && amounts) {
    cards.push(
      <KpiCard key="billed" label="Facturado" value={formatMoney(widgets.billed.currentCents)} hint={HINTS.billed} change={widgets.billed.changePercent} />,
    );
  }
  if (widgets.orders) {
    cards.push(<KpiCard key="orders" label="Pedidos" value={formatCount(widgets.orders.current)} hint={HINTS.orders} change={widgets.orders.changePercent} />);
  }
  if (widgets.ticket && amounts) {
    cards.push(
      <KpiCard key="ticket" label="Ticket promedio" value={formatMoney(widgets.ticket.currentCents)} hint={HINTS.ticket} change={widgets.ticket.changePercent} />,
    );
  }
  if (widgets.shipping && amounts) {
    cards.push(
      <KpiCard key="shipping" label="Envíos cobrados" value={formatMoney(widgets.shipping.currentCents)} hint={HINTS.shipping} change={widgets.shipping.changePercent} />,
    );
  }
  if (widgets.discounts && amounts) {
    cards.push(
      <KpiCard key="discounts" label="Descuentos" value={formatMoney(widgets.discounts.currentCents)} hint={HINTS.discounts} change={widgets.discounts.changePercent} />,
    );
  }
  if (widgets.cancellations) {
    const lost =
      amounts && widgets.cancellations.lostCents !== undefined
        ? `${formatMoney(widgets.cancellations.lostCents)} perdidos · ${formatPercent(widgets.cancellations.ratePercent.current)} de los pedidos`
        : `${formatPercent(widgets.cancellations.ratePercent.current)} de los pedidos`;
    cards.push(
      <KpiCard
        key="cancellations"
        label="Cancelaciones"
        value={formatCount(widgets.cancellations.count.current)}
        hint={HINTS.cancellations}
        change={widgets.cancellations.count.changePercent}
        invert
        secondary={lost}
      />,
    );
  }
  return cards.length > 0 ? <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">{cards}</div> : null;
}

function Block({
  title,
  action,
  children,
  description,
}: {
  title: string;
  action?: ReactNode;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 font-display text-xl font-extrabold">{title}</h2>
          {description && <p className="m-0 text-[13px] text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PnlBlock({ data }: { data: EvolutionReport }) {
  const pnl = data.widgets.pnl!;
  const rows = [
    { label: "Productos y adicionales", value: formatMoney(pnl.productsCents) },
    { label: "Envíos", value: formatMoney(pnl.shippingCents) },
    { label: "Propinas", value: formatMoney(pnl.tipsCents) },
    { label: "Descuentos", value: `−${formatMoney(pnl.discountCents)}` },
  ];
  return (
    <Block title="Cuenta de resultados">
      <dl className="m-0 flex flex-col gap-2 text-[15px]">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4 border-b border-line-soft pb-2">
            <dt className="text-muted">{row.label}</dt>
            <dd className="m-0 font-bold tabular-nums">{row.value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 pt-1 text-lg">
          <dt className="font-bold">Facturado</dt>
          <dd className="m-0 font-display font-extrabold tabular-nums">{formatMoney(pnl.billedCents)}</dd>
        </div>
        <div className="flex justify-between gap-4 text-muted">
          <dt>Costo de mercadería (CMV)</dt>
          <dd className="m-0">—</dd>
        </div>
        <div className="flex justify-between gap-4 text-muted">
          <dt>
            Ganancia neta <span className="ml-1 rounded-md bg-bg px-2 py-0.5 text-xs font-bold">Disponible con Stock</span>
          </dt>
          <dd className="m-0">—</dd>
        </div>
      </dl>
    </Block>
  );
}

function PaceBlock({ data }: { data: EvolutionReport }) {
  const pace = data.widgets.pace!;
  const tiles = [
    { label: "Día pico", value: pace.peakDay === null ? "—" : WEEKDAY_NAMES[pace.peakDay as 0 | 1 | 2 | 3 | 4 | 5 | 6] },
    { label: "Hora pico", value: pace.peakHour === null ? "—" : `${String(pace.peakHour).padStart(2, "0")}:00` },
    { label: "Pedidos por día", value: formatCount(pace.ordersPerDay) },
    { label: "Clientes nuevos", value: formatCount(pace.newCustomers) },
  ];
  return (
    <Block title="Ritmo del negocio">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="flex flex-col gap-1 rounded-xl bg-bg p-3">
            <span className="text-xs text-muted">{tile.label}</span>
            <b className="font-display text-xl font-extrabold capitalize">{tile.value}</b>
          </div>
        ))}
      </div>
    </Block>
  );
}

function TrendBlock({ data, amounts }: { data: EvolutionReport; amounts: boolean }) {
  const trend = data.widgets.trend!;
  const [metric, setMetric] = useState<TrendMetric>(amounts ? "billed" : "orders");
  const [group, setGroup] = useState<TrendGroup>("day");
  const [view, setView] = useState<TrendView>("simple");
  const [comparison, setComparison] = useState<TrendComparison>("previous");
  const effectiveMetric: TrendMetric = amounts ? metric : "orders";
  const series = buildTrendSeries(trend, data.range, group, effectiveMetric);
  const money = effectiveMetric !== "orders";
  const format = (value: number) => (money ? formatMoney(value) : formatCount(value));
  const metricLabel = effectiveMetric === "billed" ? "Facturado" : effectiveMetric === "ticket" ? "Ticket promedio" : "Pedidos";

  const option = (active: boolean) =>
    cn(
      "min-h-11 shrink-0 cursor-pointer rounded-full px-3 text-xs font-bold",
      active ? "bg-ink text-white" : "bg-tab text-muted hover:text-ink",
    );

  return (
    <Block
      title="Evolución de ventas"
      description={`${metricLabel} por ${group === "day" ? "día" : group === "week" ? "semana" : "mes"}`}
      action={
        <button
          type="button"
          disabled
          title="Próximamente"
          className="min-h-11 cursor-not-allowed rounded-xl border border-line px-3 text-xs font-bold text-muted"
        >
          Analizar con IA · Próximamente
        </button>
      }
    >
      <div className="flex flex-wrap gap-2">
        <div role="group" aria-label="Métrica" className="flex flex-wrap gap-1">
          {amounts && <button type="button" aria-pressed={effectiveMetric === "billed"} onClick={() => setMetric("billed")} className={option(effectiveMetric === "billed")}>Facturado</button>}
          <button type="button" aria-pressed={effectiveMetric === "orders"} onClick={() => setMetric("orders")} className={option(effectiveMetric === "orders")}>Pedidos</button>
          {amounts && view !== "fulfillment" && <button type="button" aria-pressed={effectiveMetric === "ticket"} onClick={() => setMetric("ticket")} className={option(effectiveMetric === "ticket")}>Ticket</button>}
        </div>
        <div role="group" aria-label="Agrupación" className="flex gap-1">
          {(["day", "week", "month"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={group === value} onClick={() => setGroup(value)} className={option(group === value)}>
              {value === "day" ? "Día" : value === "week" ? "Semana" : "Mes"}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Vista" className="flex gap-1">
          {(["simple", "compare", "trend", "fulfillment"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => {
                setView(value);
                if (value === "fulfillment" && effectiveMetric === "ticket") setMetric("billed");
              }}
              className={option(view === value)}
            >
              {value === "simple" ? "Simple" : value === "compare" ? "Comparar" : value === "trend" ? "Tendencia" : "Modalidad"}
            </button>
          ))}
        </div>
        {view === "compare" && (
          <div role="group" aria-label="Comparación" className="flex gap-1">
            {(["previous", "year"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={comparison === value} onClick={() => setComparison(value)} className={option(comparison === value)}>
                {value === "previous" ? "vs anterior" : "vs año pasado"}
              </button>
            ))}
          </div>
        )}
      </div>

      <Suspense fallback={<div className="h-[280px] animate-pulse rounded-xl bg-bg" aria-hidden="true" />}>
        <TrendChart
          labels={series.labels}
          current={series.current}
          previous={series.previous}
          year={series.year}
          average={series.average}
          delivery={series.delivery}
          takeaway={series.takeaway}
          view={view}
          comparison={comparison}
          money={money}
          metricLabel={metricLabel}
        />
      </Suspense>

      <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-line-soft pt-3 text-sm">
        <span>
          <span className="text-muted">Total del período: </span>
          <b className="tabular-nums">{format(series.total)}</b>
        </span>
        <span>
          <span className="text-muted">{view === "compare" && comparison === "year" ? "Año pasado: " : "Período anterior: "}</span>
          <b className="tabular-nums">{format(view === "compare" && comparison === "year" ? series.yearTotal : series.previousTotal)}</b>
        </span>
        {amounts && trend.projectionCents !== undefined && (
          <span>
            <span className="text-muted">Proyección del mes: </span>
            <b className="tabular-nums">{formatMoney(trend.projectionCents)}</b>
          </span>
        )}
      </div>
    </Block>
  );
}

function HeatmapBlock({ data }: { data: EvolutionReport }) {
  const heatmap = data.widgets.heatmap!;
  return (
    <Block title="Día y hora" description="Cantidad de pedidos, con 5 niveles relativos al máximo del período.">
      <div className="overflow-x-auto">
        <div className="grid min-w-[620px] gap-1" style={{ gridTemplateColumns: "3.2rem repeat(24, minmax(14px, 1fr))" }}>
          <span aria-hidden="true" />
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour} className="text-center text-[10px] text-muted">
              {hour % 3 === 0 ? hour : ""}
            </span>
          ))}
          {DAYS_FROM_MONDAY.map((weekday, row) => (
            <div key={weekday} className="contents">
              <span className="text-xs font-bold text-muted capitalize">{WEEKDAY_NAMES[weekday]}</span>
              {Array.from({ length: 24 }, (_, hour) => {
                const count = heatmap.cells[row]?.[hour] ?? 0;
                const level = heatmap.max === 0 ? 0 : Math.ceil((count / heatmap.max) * 5);
                return (
                  <span
                    key={hour}
                    role="img"
                    title={`${WEEKDAY_NAMES[weekday]} ${hour}:00 · ${count} ${count === 1 ? "pedido" : "pedidos"}`}
                    aria-label={`${WEEKDAY_NAMES[weekday]} ${hour}:00, ${count} pedidos`}
                    className="aspect-square rounded-[3px]"
                    style={{
                      backgroundColor: level === 0 ? "var(--color-line-soft)" : "var(--color-primary)",
                      opacity: level === 0 ? 1 : 0.2 + (level / 5) * 0.8,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Block>
  );
}

function MoversBlock({ data }: { data: EvolutionReport }) {
  const movers = data.widgets.movers!;
  const row = (entry: { name: string; units: number; previousUnits: number; delta: number }, up: boolean) => (
    <li key={entry.name} className="flex items-center justify-between gap-4 border-b border-line-soft py-2 last:border-0">
      <span className="min-w-0 truncate text-sm">{entry.name}</span>
      <span className="flex shrink-0 items-center gap-2 text-sm tabular-nums">
        <span className="text-muted">{formatCount(entry.units)} u.</span>
        <span className={cn("rounded-md px-2 py-0.5 text-xs font-bold", up ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
          {up ? "+" : ""}
          {formatCount(entry.delta)}
        </span>
      </span>
    </li>
  );
  return (
    <Block title="Productos en alza y en baja" description="Unidades contra el período anterior.">
      {movers.up.length === 0 && movers.down.length === 0 ? (
        <p className="m-0 text-sm text-muted">Sin cambios contra el período anterior.</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <h3 className="m-0 mb-1 text-sm font-bold text-success">En alza</h3>
            {movers.up.length === 0 ? <p className="m-0 text-sm text-muted">Sin subas.</p> : <ul className="m-0 list-none p-0">{movers.up.map((entry) => row(entry, true))}</ul>}
          </div>
          <div>
            <h3 className="m-0 mb-1 text-sm font-bold text-danger">En baja</h3>
            {movers.down.length === 0 ? <p className="m-0 text-sm text-muted">Sin bajas.</p> : <ul className="m-0 list-none p-0">{movers.down.map((entry) => row(entry, false))}</ul>}
          </div>
        </div>
      )}
    </Block>
  );
}

function PaymentMethodsBlock({ data, amounts, exportable }: { data: EvolutionReport; amounts: boolean; exportable: boolean }) {
  const payment = data.widgets.payment_methods!;
  const rows = payment.rows;
  const columns = [
    { header: "Medio", value: (row: (typeof rows)[number]) => (row.method === "cash" ? PAYMENT_LABELS.cash : PAYMENT_LABELS.transfer) },
    { header: "Pedidos", value: (row: (typeof rows)[number]) => row.orders },
    ...(amounts ? [{ header: "Facturado", value: (row: (typeof rows)[number]) => row.billedCents ?? 0, money: true }] : []),
    { header: "%", value: (row: (typeof rows)[number]) => row.percent },
  ];
  const donut = [
    { name: PAYMENT_LABELS.cash, value: rows.find((row) => row.method === "cash")?.billedCents ?? 0 },
    { name: PAYMENT_LABELS.transfer, value: rows.find((row) => row.method === "transfer")?.billedCents ?? 0 },
  ];
  return (
    <Block
      title="Medios de pago"
      action={exportable ? <ExportButton tab="evolucion" block="payment-methods" from={data.range.from} to={data.range.to} rows={rows} columns={columns} /> : undefined}
    >
      <div className={cn("grid gap-4", amounts ? "md:grid-cols-[220px_1fr]" : "")}>
        {amounts && (
          <Suspense fallback={<div className="h-[220px] animate-pulse rounded-xl bg-bg" aria-hidden="true" />}>
            <DonutChart data={donut} money />
          </Suspense>
        )}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="px-3 py-2 font-bold">Medio</th>
                <th className="px-3 py-2 text-right font-bold">Pedidos</th>
                {amounts && <th className="px-3 py-2 text-right font-bold">Facturado</th>}
                <th className="px-3 py-2 text-right font-bold">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.method}>
                  <td className="px-3 py-2 font-bold">{row.method === "cash" ? PAYMENT_LABELS.cash : PAYMENT_LABELS.transfer}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCount(row.orders)}</td>
                  {amounts && <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.billedCents ?? 0)}</td>}
                  <td className="px-3 py-2 text-right tabular-nums">{formatPercent(row.percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="m-0 text-xs text-muted">{payment.note}.</p>
    </Block>
  );
}

function CustomersBlock({ data, amounts, exportable }: { data: EvolutionReport; amounts: boolean; exportable: boolean }) {
  const customers = data.widgets.customers!;
  const columns = [
    { header: "Cliente", value: (row: (typeof customers.top)[number]) => row.name },
    { header: "Teléfono", value: (row: (typeof customers.top)[number]) => row.phone },
    { header: "Pedidos", value: (row: (typeof customers.top)[number]) => row.orders },
    ...(amounts ? [{ header: "Facturado", value: (row: (typeof customers.top)[number]) => row.billedCents ?? 0, money: true }] : []),
  ];
  const tiles = [
    { label: "Clientes únicos", value: formatCount(customers.unique) },
    { label: "Volvieron a comprar", value: formatCount(customers.returning) },
    { label: "Tasa de retorno", value: formatPercent(customers.ratePercent) },
    ...(amounts ? [{ label: "Facturado por recurrentes", value: formatMoney(customers.returningBilledCents ?? 0) }] : []),
  ];
  return (
    <Block
      title="Clientes recurrentes"
      action={exportable ? <ExportButton tab="evolucion" block="customers" from={data.range.from} to={data.range.to} rows={customers.top} columns={columns} /> : undefined}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="flex flex-col gap-1 rounded-xl bg-bg p-3">
            <span className="text-xs text-muted">{tile.label}</span>
            <b className="font-display text-xl font-extrabold tabular-nums">{tile.value}</b>
          </div>
        ))}
      </div>
      {customers.top.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="px-3 py-2 font-bold">Cliente</th>
                <th className="px-3 py-2 font-bold">Teléfono</th>
                <th className="px-3 py-2 text-right font-bold">Pedidos</th>
                {amounts && <th className="px-3 py-2 text-right font-bold">Facturado</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {customers.top.map((row) => (
                <tr key={`${row.name}-${row.phone}`}>
                  <td className="px-3 py-2 font-bold">{row.name}</td>
                  <td className="px-3 py-2">{row.phone}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCount(row.orders)}</td>
                  {amounts && <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.billedCents ?? 0)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Block>
  );
}
