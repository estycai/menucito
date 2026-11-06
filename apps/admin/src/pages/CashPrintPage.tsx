import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import {
  formatArs,
  formatCashDifference,
  formatLocalDateTime,
  type CashMovement,
} from "@menucito/shared";
import { QueryError } from "@/components/QueryError";
import { Button } from "@/components/ui/button";
import { CASH_UI_MESSAGES, useCashSession } from "@/lib/cash";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useMyRestaurant } from "@/lib/restaurant";
import { courierPaymentLabel, movementMethodText } from "@/lib/cash-labels";

/** A4 print view of a closed arqueo; the browser saves it as PDF from the print dialog. */
export function CashPrintPage() {
  const { id } = useParams();
  const query = useCashSession(id ?? null);
  const { data: restaurant } = useMyRestaurant();
  const detail = query.data;
  // Captured once, so re-renders do not change the printed timestamp.
  const [printedAt] = useState(() => Date.now());
  useDocumentTitle("Arqueo impreso");

  if (query.isError) {
    return (
      <div className="mx-auto max-w-[794px] p-8">
        <QueryError message={CASH_UI_MESSAGES.detailFailed} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  if (query.isLoading || !detail) {
    return <div className="p-8 text-center text-muted">Cargando el arqueo...</div>;
  }

  const session = detail.session;
  const cash = detail.totals.cash;
  const transfer = detail.totals.transfer;
  const difference = session.differenceCents ?? 0;

  return (
    <div className="min-h-screen bg-bg p-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[794px] justify-between gap-2 print:hidden">
        <Link to={`/cajas/${session.id}`} className="self-center text-sm font-bold text-link hover:underline">
          ← Volver al arqueo
        </Link>
        <Button type="button" onClick={() => window.print()} className="min-h-11 px-5 text-sm">
          Imprimir o guardar PDF
        </Button>
      </div>

      <article className="mx-auto box-border flex w-[794px] max-w-full flex-col gap-4 bg-white p-14 text-black print:p-0">
        <header className="flex items-end justify-between gap-4 border-b-2 border-black pb-3">
          <div>
            <div className="text-[13px]">{restaurant?.name ?? ""}</div>
            <h1 className="m-0 font-display text-[26px] font-extrabold">
              Arqueo del {formatLocalDateTime(session.openedAt).slice(0, 10)}
            </h1>
          </div>
          <div className="text-right text-[12px]">
            Apertura de caja: {formatLocalDateTime(session.openedAt)} por {session.openedByName}
            <br />
            Cierre de caja: {session.closedAt !== null ? formatLocalDateTime(session.closedAt) : "—"} por{" "}
            {session.closedByName ?? "—"}
          </div>
        </header>

        <div className="grid grid-cols-2 gap-7">
          <MethodBlock
            title="Efectivo"
            rows={[
              ["Monto inicial", formatArs(cash.openingCents ?? 0)],
              [`Ventas (${cash.salesCount})`, formatArs(cash.salesCents)],
              ...((cash.incomeCents ?? 0) > 0 ? [[`Ingresos (${cash.incomeCount})`, `+${formatArs(cash.incomeCents ?? 0)}`] as [string, string]] : []),
              ...((cash.expenseCents ?? 0) > 0 ? [[`Egresos (${cash.expenseCount})`, `−${formatArs(cash.expenseCents ?? 0)}`] as [string, string]] : []),
            ]}
            total={["Esperado en caja", formatArs(cash.totalCents ?? 0)]}
          />
          <MethodBlock
            title="Transferencia"
            rows={[
              [`Ventas (${transfer.salesCount})`, formatArs(transfer.salesCents)],
              ["Propinas (a repartidores)", formatArs(transfer.tipCents)],
              ...((transfer.incomeCents ?? 0) > 0 ? [[`Ingresos (${transfer.incomeCount})`, `+${formatArs(transfer.incomeCents ?? 0)}`] as [string, string]] : []),
              ...((transfer.expenseCents ?? 0) > 0 ? [[`Egresos (${transfer.expenseCount})`, `−${formatArs(transfer.expenseCents ?? 0)}`] as [string, string]] : []),
            ]}
            total={["Total", formatArs(transfer.totalCents ?? 0)]}
          />
        </div>

        <MethodBlock
          title="Totales"
          rows={[
            [`Total ventas (${detail.totals.salesCount})`, formatArs(detail.totals.salesCents)],
          ]}
          total={["Total consolidado", formatArs(detail.totals.consolidatedCents ?? 0)]}
        />

        <div className="grid grid-cols-2 gap-7">
          <SimpleBlock
            title="Ingresos por repartidor"
            rows={
              detail.courierIncomes.length === 0
                ? [["Sin ingresos", "—"]]
                : detail.courierIncomes.map((income) =>
                    [
                      `${income.courier ? `${income.courier.firstName} ${income.courier.lastName}` : "Sin repartidor"} · ${income.ordersCount} ${income.ordersCount === 1 ? "pedido" : "pedidos"}`,
                      formatArs(income.cents),
                    ] as [string, string],
                  )
            }
          />
          <SimpleBlock
            title="Pagos a repartidores"
            rows={[
              ...(detail.courierPayments.length === 0
                ? [["Sin pagos", "—"] as [string, string]]
                : detail.courierPayments.map(
                    (payment) => [courierPaymentLabel(payment), formatArs(payment.amountCents)] as [string, string],
                  )),
              // The tips are what the couriers are owed, not a payment: shown apart so they don't read as paid.
              ...(detail.tipsCents > 0
                ? [["Propinas cobradas (a pagar)", formatArs(detail.tipsCents)] as [string, string]]
                : []),
            ]}
          />
        </div>

        <div>
          <BlockTitle>Movimientos ({detail.movements.filter((movement) => movement.voidedAt === null).length} + {detail.movements.filter((movement) => movement.voidedAt !== null).length} anulados)</BlockTitle>
          {detail.movements.length === 0 ? (
            <p className="m-0 text-[12.5px]">Sin movimientos.</p>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {detail.movements.map((movement) => (
                  <MovementRow key={movement.id} movement={movement} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <SimpleBlock
          title="En la calle (no cuenta en el esperado)"
          rows={
            detail.onTheStreet.length === 0
              ? [["Sin plata en la calle", "—"]]
              : detail.onTheStreet.map((group) =>
                  [
                    `${group.courier ? `${group.courier.firstName} ${group.courier.lastName}` : "Sin repartidor"} · ${group.ordersCount} ${group.ordersCount === 1 ? "pedido" : "pedidos"} sin ingresar${
                      group.changeCents > 0 ? ` + cambio ${formatArs(group.changeCents)}` : ""
                    }`,
                    formatArs(group.totalCents),
                  ] as [string, string],
                )
          }
        />

        <div className="border-2 border-black p-4">
          <div className="text-xs font-bold tracking-wide uppercase">Cierre de caja</div>
          <table className="w-full border-collapse text-[12.5px]">
            <tbody>
              <tr>
                <td className="py-0.5">Efectivo contado</td>
                <td className="py-0.5 text-right tabular-nums whitespace-nowrap">{formatArs(session.countedCashCents ?? 0)}</td>
              </tr>
              <tr>
                <td className="py-0.5">Efectivo esperado</td>
                <td className="py-0.5 text-right tabular-nums whitespace-nowrap">{formatArs(session.expectedCashCents ?? 0)}</td>
              </tr>
              <tr className="font-bold">
                <td className="py-0.5">Diferencia: {formatCashDifference(difference).replace(/ \$.*$/, "").toUpperCase()}</td>
                <td className="py-0.5 text-right tabular-nums whitespace-nowrap">
                  {difference < 0 ? "−" : difference > 0 ? "+" : ""}
                  {formatArs(Math.abs(difference))}
                </td>
              </tr>
            </tbody>
          </table>
          {session.closeNote && <div className="mt-1 text-[12px]">Nota: {session.closeNote}</div>}
        </div>

        <footer className="mt-auto flex justify-between text-[11px]">
          <span>Impreso el {formatLocalDateTime(printedAt)} · menucito</span>
          <span>Página 1 de 1</span>
        </footer>
      </article>
    </div>
  );
}

function BlockTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 border-b-[1.5px] border-black pb-0.5 text-xs font-bold tracking-wide uppercase">
      {children}
    </div>
  );
}

function MethodBlock({
  title,
  rows,
  total,
}: {
  title: string;
  rows: [string, string][];
  total: [string, string];
}) {
  return (
    <div>
      <BlockTitle>{title}</BlockTitle>
      <table className="w-full border-collapse text-[12.5px]">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td className="py-0.5">{label}</td>
              <td className="py-0.5 text-right tabular-nums whitespace-nowrap">{value}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="py-0.5">{total[0]}</td>
            <td className="py-0.5 text-right tabular-nums whitespace-nowrap">{total[1]}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SimpleBlock({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <BlockTitle>{title}</BlockTitle>
      <table className="w-full border-collapse text-[12.5px]">
        <tbody>
          {rows.map(([label, value], index) => (
            <tr key={`${label}-${index}`}>
              <td className="py-0.5">{label}</td>
              <td className="py-0.5 text-right tabular-nums whitespace-nowrap">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MovementRow({ movement }: { movement: CashMovement }) {
  const voided = movement.voidedAt !== null;
  const income = movement.kind === "income" || movement.kind === "order_split_income" || movement.kind === "courier_change_back";
  return (
    <tr className={voided ? "text-muted" : undefined}>
      <td className={`py-0.5 text-[12.5px] ${voided ? "line-through" : ""}`}>
        {[movement.comment, movementMethodText(movement), formatLocalDateTime(movement.createdAt), movement.createdByName]
          .filter(Boolean)
          .join(" · ")}
        {voided ? ` · Anulado por ${movement.voidedByName ?? ""}` : ""}
      </td>
      <td className={`py-0.5 text-right text-[12.5px] tabular-nums whitespace-nowrap ${voided ? "line-through" : ""}`}>
        {income ? "+" : "−"}
        {formatArs(movement.amountCents)}
      </td>
    </tr>
  );
}
