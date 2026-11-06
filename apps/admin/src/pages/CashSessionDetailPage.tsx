import { Link, useParams } from "react-router";
import {
  formatArs,
  formatCashDifference,
  formatLocalDateTime,
  type CashMethodTotals,
} from "@menucito/shared";
import { QueryError } from "@/components/QueryError";
import { MovementList } from "@/components/cash/MovementList";
import { Button } from "@/components/ui/button";
import { CASH_UI_MESSAGES, useCashSession } from "@/lib/cash";
import { useDocumentTitle } from "@/lib/use-document-title";
import { cn } from "@/lib/utils";
import { courierPaymentLabel } from "@/lib/cash-labels";

/** Detail of a closed arqueo, read from the snapshot written at close. */
export function CashSessionDetailPage() {
  const { id } = useParams();
  const query = useCashSession(id ?? null);
  const detail = query.data;
  useDocumentTitle("Arqueo");

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link to="/cajas/historial" className="text-sm font-bold text-link hover:underline">
            ← Historial de arqueos
          </Link>
          <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">
            {detail ? `Arqueo del ${formatLocalDateTime(detail.session.openedAt).slice(0, 10)}` : "Arqueo"}
          </h1>
        </div>
        {id && (
          <Button asChild variant="outline" className="px-4 text-sm font-bold">
            <Link to={`/cajas/${id}/imprimir`}>Imprimir</Link>
          </Button>
        )}
      </div>

      {query.isError ? (
        <QueryError message={CASH_UI_MESSAGES.detailFailed} onRetry={() => void query.refetch()} />
      ) : query.isLoading || !detail ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">Cargando el arqueo...</div>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 rounded-2xl border border-line bg-white p-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted">Apertura de caja</span>
              <b>{formatLocalDateTime(detail.session.openedAt)}</b>
              <span className="text-[13px] text-muted">por {detail.session.openedByName}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted">Cierre de caja</span>
              <b>{detail.session.closedAt !== null ? formatLocalDateTime(detail.session.closedAt) : "—"}</b>
              <span className="text-[13px] text-muted">por {detail.session.closedByName ?? "—"}</span>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <MethodCard title="Efectivo" totals={detail.totals.cash} />
            <MethodCard title="Transferencia" totals={detail.totals.transfer} />
          </section>

          <section className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-5 text-[15px]">
            <div className="flex justify-between">
              <span>Total ventas ({detail.totals.salesCount})</span>
              <b className="tabular-nums">{formatArs(detail.totals.salesCents)}</b>
            </div>
            <div className="flex justify-between text-lg font-extrabold">
              <span>Total consolidado</span>
              <span className="tabular-nums">{formatArs(detail.totals.consolidatedCents ?? 0)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <span className="text-sm text-muted">Efectivo contado</span>
              <b className="tabular-nums">{formatArs(detail.session.countedCashCents ?? 0)}</b>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted">Efectivo esperado</span>
              <b className="tabular-nums">{formatArs(detail.session.expectedCashCents ?? 0)}</b>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted">Diferencia</span>
              <DifferencePill difference={detail.session.differenceCents ?? 0} />
            </div>
            {detail.session.closeNote && (
              <p className="m-0 mt-1 text-sm text-muted">Nota: {detail.session.closeNote}</p>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-line bg-white p-5">
              <h2 className="m-0 mb-2 font-display text-lg font-extrabold">Ingresos por repartidor</h2>
              {detail.courierIncomes.length === 0 ? (
                <p className="m-0 text-sm text-muted">No hubo ingresos de repartidores.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                  {detail.courierIncomes.map((income) => (
                    <li key={income.courier?.memberId ?? "none"} className="flex justify-between gap-3">
                      <span>
                        {income.courier ? `${income.courier.firstName} ${income.courier.lastName}` : "Sin repartidor"} ·{" "}
                        {income.ordersCount} {income.ordersCount === 1 ? "pedido" : "pedidos"}
                      </span>
                      <b className="tabular-nums">{formatArs(income.cents)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-line bg-white p-5">
              <h2 className="m-0 mb-2 font-display text-lg font-extrabold">Pagos a repartidores</h2>
              {detail.courierPayments.length === 0 ? (
                <p className="m-0 text-sm text-muted">No hubo pagos a repartidores.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                  {detail.courierPayments.map((payment) => (
                    <li key={payment.id} className="flex justify-between gap-3">
                      <span>{courierPaymentLabel(payment)}</span>
                      <b className="tabular-nums">{formatArs(payment.amountCents)}</b>
                    </li>
                  ))}
                </ul>
              )}
              {/* What the couriers are owed, apart from the payments so it does not read as already paid. */}
              {detail.tipsCents > 0 && (
                <p className="m-0 mt-2 flex justify-between gap-3 border-t border-line-soft pt-2 text-sm">
                  <span>Propinas cobradas (a pagar)</span>
                  <b className="tabular-nums">{formatArs(detail.tipsCents)}</b>
                </p>
              )}
            </section>
          </div>

          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="m-0 mb-2 font-display text-lg font-extrabold">En la calle (no cuenta en el esperado)</h2>
            {detail.onTheStreet.length === 0 ? (
              <p className="m-0 text-sm text-muted">No quedó plata en la calle.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                {detail.onTheStreet.map((group) => (
                  <li key={group.courier?.memberId ?? "none"} className="flex justify-between gap-3">
                    <span>
                      {group.courier ? `${group.courier.firstName} ${group.courier.lastName}` : "Sin repartidor"} ·{" "}
                      {group.ordersCount} {group.ordersCount === 1 ? "pedido" : "pedidos"} sin ingresar
                      {group.changeCents > 0 ? ` + cambio ${formatArs(group.changeCents)}` : ""}
                    </span>
                    <b className="tabular-nums">{formatArs(group.totalCents)}</b>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="m-0 mb-1 font-display text-lg font-extrabold">
              Movimientos ({detail.movements.length})
            </h2>
            <MovementList movements={detail.movements} canManage={false} onEdit={() => {}} onVoid={() => {}} />
          </section>
        </>
      )}
    </div>
  );
}

function MethodCard({ title, totals }: { title: string; totals: CashMethodTotals }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h2 className="m-0 mb-2 text-xs font-bold tracking-wide text-muted uppercase">{title}</h2>
      {totals.openingCents !== null && (
        <Line label="Monto inicial" value={formatArs(totals.openingCents)} />
      )}
      <Line label={`Ventas (${totals.salesCount})`} value={formatArs(totals.salesCents)} />
      {totals.tipCents > 0 && <Line label={`Propinas (${totals.tipCount})`} value={formatArs(totals.tipCents)} />}
      {(totals.incomeCents ?? 0) > 0 && (
        <Line label={`Ingresos (${totals.incomeCount})`} value={`+${formatArs(totals.incomeCents ?? 0)}`} />
      )}
      {(totals.expenseCents ?? 0) > 0 && (
        <Line label={`Egresos (${totals.expenseCount})`} value={`−${formatArs(totals.expenseCents ?? 0)}`} />
      )}
      <Line label={title === "Efectivo" ? "Esperado en caja" : "Total"} value={formatArs(totals.totalCents ?? 0)} strong />
    </section>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3 py-1 text-sm", strong && "mt-1 border-t border-line pt-2 font-extrabold")}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function DifferencePill({ difference }: { difference: number }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap",
        difference > 0
          ? "bg-success-soft text-success"
          : difference < 0
            ? "bg-danger-soft text-danger"
            : "bg-tab text-muted",
      )}
    >
      {formatCashDifference(difference)}
    </span>
  );
}
