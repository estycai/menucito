import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  CASH_MESSAGES,
  formatArs,
  formatCashDifference,
  formatLocalDateTime,
  type CashCloseResult,
  type CashMovement,
  type CashSettlementGroup,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { QueryError } from "@/components/QueryError";
import { CloseCashDialog } from "@/components/cash/CloseCashDialog";
import { CloseResultDialog } from "@/components/cash/CloseResultDialog";
import { CourierChangeDialog } from "@/components/cash/CourierChangeDialog";
import { EditMovementDialog } from "@/components/cash/EditMovementDialog";
import { MovementList } from "@/components/cash/MovementList";
import { NewMovementDialog } from "@/components/cash/NewMovementDialog";
import { SettleDialog } from "@/components/cash/SettleDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccess } from "@/lib/access";
import {
  CASH_UI_MESSAGES,
  cashErrorMessage,
  centsInput,
  pesosCents,
  sessionSalesPath,
  useCashCurrent,
  useOpenCash,
  useVoidCashMovement,
} from "@/lib/cash";
import { useDocumentTitle } from "@/lib/use-document-title";
import { cn } from "@/lib/utils";

type Dialog =
  | { kind: "new"; courierId?: string | null }
  | { kind: "edit"; movement: CashMovement }
  | { kind: "void"; movement: CashMovement }
  | { kind: "settle"; group: CashSettlementGroup }
  | { kind: "change"; courierId?: string | null }
  | { kind: "close" };

export function CashPage() {
  useDocumentTitle("Cajas");
  const { can } = useAccess();
  const canSeeExpected = can("cash.expected");
  const query = useCashCurrent(can("cash.view"));
  const current = query.data;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [closeResult, setCloseResult] = useState<CashCloseResult | null>(null);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Cajas</h1>
          <span className="text-sm text-muted">
            {current?.session
              ? "Los cobros del turno se suman solos a la caja abierta."
              : "Abrí la caja al empezar el turno y cerrala al terminar para hacer el arqueo."}
          </span>
        </div>
        {can("cash.history") && (
          <Button asChild variant="outline" className="px-4 text-sm font-bold">
            <Link to="/cajas/historial">Historial de arqueos</Link>
          </Button>
        )}
      </div>

      {query.isError ? (
        <QueryError message={CASH_UI_MESSAGES.loadFailed} onRetry={() => void query.refetch()} />
      ) : query.isLoading || !current ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">Cargando la caja...</div>
      ) : !current.session ? (
        <ClosedCash current={current} canOpen={can("cash.open")} canHistory={can("cash.history")} />
      ) : (
        <OpenCash
          current={current}
          canSeeExpected={canSeeExpected}
          canClose={can("cash.close")}
          canSettle={can("cash.settle")}
          canMovements={can("cash.movements")}
          canOrders={can("orders.view")}
          onDialog={setDialog}
        />
      )}

      {dialog?.kind === "new" && current?.session && (
        <NewMovementDialog
          current={current}
          initialCourierId={dialog.courierId}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "edit" && <EditMovementDialog movement={dialog.movement} onClose={() => setDialog(null)} />}
      {dialog?.kind === "void" && <VoidMovementDialog movement={dialog.movement} onClose={() => setDialog(null)} />}
      {dialog?.kind === "settle" && <SettleDialog group={dialog.group} onClose={() => setDialog(null)} />}
      {dialog?.kind === "change" && current?.session && (
        <CourierChangeDialog
          accounts={current.courierAccounts}
          initialCourierId={dialog.courierId}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "close" && current?.session && (
        <CloseCashDialog
          current={current}
          canSeeExpected={canSeeExpected}
          onClose={() => setDialog(null)}
          onClosed={(result) => {
            setDialog(null);
            setCloseResult(result);
          }}
        />
      )}
      {closeResult && <CloseResultDialog result={closeResult} onClose={() => setCloseResult(null)} />}
    </div>
  );
}

function ClosedCash({
  current,
  canOpen,
  canHistory,
}: {
  current: NonNullable<ReturnType<typeof useCashCurrent>["data"]>;
  canOpen: boolean;
  canHistory: boolean;
}) {
  return (
    <>
      {current.chargedWithoutCashToday.count > 0 && (
        <Notice tone="warning">
          <b>
            Hoy se cobraron {current.chargedWithoutCashToday.count}{" "}
            {current.chargedWithoutCashToday.count === 1 ? "pedido" : "pedidos"} sin caja abierta.
          </b>{" "}
          No entran en ningún arqueo.{" "}
          <Link to="/pedidos?paymentStatus=paid" className="font-bold underline">
            Ver pedidos
          </Link>
        </Notice>
      )}

      <section className="flex max-w-[520px] flex-col gap-4 rounded-2xl border border-line bg-white p-6">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-xl bg-tab text-xl">
            ▤
          </span>
          <div className="flex flex-col">
            <h2 className="m-0 font-display text-xl font-extrabold">Caja cerrada</h2>
            <span className="text-[15px] text-muted">Abrí la caja para que los cobros del turno se sumen solos.</span>
          </div>
        </div>
        {canOpen ? (
          <OpenCashForm suggestionCents={current.openingSuggestionCents} hasPreviousClose={current.lastClosed !== null} />
        ) : (
          <p className="m-0 text-sm text-muted">No tenés permiso para abrir la caja.</p>
        )}
      </section>

      {current.lastClosed && (
        <section className="flex max-w-[520px] flex-col gap-2">
          <span className="text-xs font-bold tracking-wide text-muted uppercase">Último arqueo</span>
          {canHistory ? (
            <Link
              to={`/cajas/${current.lastClosed.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-5 py-4"
            >
              <span className="flex flex-col">
                <b>
                  {formatLocalDateTime(current.lastClosed.openedAt)} a{" "}
                  {current.lastClosed.closedAt !== null ? formatLocalDateTime(current.lastClosed.closedAt) : "—"}
                </b>
                <span className="text-[13px] text-muted">
                  Cerró {current.lastClosed.closedByName ?? ""} · contado {formatArs(current.lastClosed.countedCashCents ?? 0)}
                </span>
              </span>
              <DifferencePill difference={current.lastClosed.differenceCents ?? 0} />
            </Link>
          ) : (
            <div className="rounded-2xl border border-line bg-white px-5 py-4">
              Cerró {current.lastClosed.closedByName ?? ""} · contado{" "}
              {formatArs(current.lastClosed.countedCashCents ?? 0)}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function OpenCashForm({ suggestionCents, hasPreviousClose }: { suggestionCents: number; hasPreviousClose: boolean }) {
  const mutation = useOpenCash();
  const [amount, setAmount] = useState(centsInput(suggestionCents));
  const [error, setError] = useState<string | null>(null);
  const cents = pesosCents(amount);
  const invalid = typeof cents !== "number" || cents < 0;

  async function open() {
    setError(null);
    if (invalid) return;
    try {
      await mutation.mutateAsync({ openingCashCents: cents as number });
    } catch (err) {
      setError(cashErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs font-bold text-muted">
        Monto inicial en efectivo
        <Input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <span className="font-normal text-muted">
          {hasPreviousClose
            ? "Lo que contaste al cerrar la caja anterior. Cambialo si sacaste plata de la caja."
            : "El efectivo con el que arranca la caja. Puede ser 0."}
        </span>
      </label>
      {invalid && <p className="m-0 text-[13px] text-danger">{CASH_MESSAGES.openingInvalid}</p>}
      {error && <Notice tone="error">{error}</Notice>}
      <Button
        type="button"
        disabled={mutation.isPending || invalid}
        onClick={() => void open()}
        className="min-h-12 self-start rounded-xl px-5 text-[15px]"
      >
        {mutation.isPending ? "Abriendo…" : "Abrir caja"}
      </Button>
    </div>
  );
}

function OpenCash({
  current,
  canSeeExpected,
  canClose,
  canSettle,
  canMovements,
  canOrders,
  onDialog,
}: {
  current: NonNullable<ReturnType<typeof useCashCurrent>["data"]>;
  canSeeExpected: boolean;
  canClose: boolean;
  canSettle: boolean;
  canMovements: boolean;
  canOrders: boolean;
  onDialog: (dialog: Dialog) => void;
}) {
  const session = current.session!;
  const totals = current.totals;
  if (!totals) return null;
  const cash = totals.cash;
  const transfer = totals.transfer;
  const settleCount = current.toSettle.reduce((sum, group) => sum + group.orders.length, 0);

  return (
    <>
      {current.storeClosed && canClose && (
        <Notice tone="warning">
          <b>El local ya cerró.</b> Cerrá la caja para hacer el arqueo.
        </Notice>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-white px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col">
              <h2 className="m-0 font-display text-xl font-extrabold">Caja abierta</h2>
              <span className="text-sm text-muted">
                Apertura de caja · por {session.openedByName} · {formatLocalDateTime(session.openedAt)}
              </span>
            </div>
            <span className="shrink-0 whitespace-nowrap rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold text-success">● Abierta</span>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="flex flex-col">
              <span className="pb-1 text-xs font-bold tracking-wide text-muted uppercase">Efectivo</span>
              {canSeeExpected && <Row label="Monto inicial" value={formatArs(cash.openingCents ?? 0)} />}
              <Row
                label={
                  canOrders ? (
                    <Link to={sessionSalesPath(session.id)} className="underline">
                      {cash.salesCount} {cash.salesCount === 1 ? "venta" : "ventas"}
                    </Link>
                  ) : (
                    `${cash.salesCount} ${cash.salesCount === 1 ? "venta" : "ventas"}`
                  )
                }
                value={formatArs(cash.salesCents)}
              />
              {canSeeExpected && (cash.incomeCents ?? 0) > 0 && (
                <Row label={`Ingresos (${cash.incomeCount})`} value={`+${formatArs(cash.incomeCents ?? 0)}`} tone="success" />
              )}
              {canSeeExpected && (cash.expenseCents ?? 0) > 0 && (
                <Row label={`Egresos (${cash.expenseCount})`} value={`−${formatArs(cash.expenseCents ?? 0)}`} tone="danger" />
              )}
              {canSeeExpected && (
                <Row label="Esperado en caja" value={formatArs(cash.totalCents ?? 0)} strong />
              )}
              {!canSeeExpected && (
                <p className="m-0 mt-2 text-[13px] text-muted">
                  Tu rol cierra a ciegas: contás el efectivo y la diferencia se ve después de cerrar.
                </p>
              )}
            </div>

            <div className="flex flex-col">
              <span className="pb-1 text-xs font-bold tracking-wide text-muted uppercase">Transferencia</span>
              <Row
                label={
                  canOrders ? (
                    <Link to={sessionSalesPath(session.id)} className="underline">
                      {transfer.salesCount} {transfer.salesCount === 1 ? "venta" : "ventas"}
                    </Link>
                  ) : (
                    `${transfer.salesCount} ${transfer.salesCount === 1 ? "venta" : "ventas"}`
                  )
                }
                value={formatArs(transfer.salesCents)}
              />
              {transfer.tipCents > 0 && <Row label="Propinas (a repartidores)" value={formatArs(transfer.tipCents)} />}
              {(transfer.incomeCents ?? 0) > 0 && (
                <Row
                  label={`Ingresos (${transfer.incomeCount})`}
                  value={`+${formatArs(transfer.incomeCents ?? 0)}`}
                  tone="success"
                />
              )}
              {(transfer.expenseCents ?? 0) > 0 && (
                <Row
                  label={`Egresos (${transfer.expenseCount})`}
                  value={`−${formatArs(transfer.expenseCents ?? 0)}`}
                  tone="danger"
                />
              )}
              <Row label="Total" value={formatArs(transfer.totalCents ?? 0)} strong />
            </div>
          </div>

          <div className="flex flex-col gap-1 border-t border-line pt-2">
            <Row label={`Total ventas (${totals.salesCount})`} value={formatArs(totals.salesCents)} />
            {canSeeExpected && (
              <Row label="Total consolidado" value={formatArs(totals.consolidatedCents ?? 0)} strong />
            )}
            <div className="mt-1 rounded-xl bg-tab p-3 text-sm">
              <b>En la calle: {formatArs(current.onTheStreet.totalCents)}</b> (no cuenta). Pedidos sin ingresar{" "}
              {formatArs(current.onTheStreet.ordersCents)} + cambio de repartidores{" "}
              {formatArs(current.onTheStreet.changeCents)}.
            </div>
          </div>

          {canClose && (
            <Button
              type="button"
              onClick={() => onDialog({ kind: "close" })}
              className="min-h-11 self-end rounded-xl bg-danger px-5 text-sm hover:bg-danger/90"
            >
              Cerrar caja
            </Button>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-1 rounded-2xl border border-line bg-white px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="m-0 font-display text-lg font-extrabold">A ingresar ({settleCount})</h2>
              {canSettle && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onDialog({ kind: "change" })}
                  className="min-h-10 px-3 text-sm font-bold"
                >
                  Dar cambio
                </Button>
              )}
            </div>
            {current.toSettle.length === 0 ? (
              <p className="m-0 py-2 text-sm text-muted">No hay pedidos entregados sin ingresar.</p>
            ) : (
              current.toSettle.map((group) => (
                <div
                  key={group.courier?.memberId ?? "none"}
                  className="flex items-center gap-3 border-b border-line-soft py-2 last:border-0"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b>
                      {group.courier ? `${group.courier.firstName} ${group.courier.lastName}` : "Sin repartidor"}
                    </b>
                    <span className="text-[13px] text-muted">
                      {group.orders.length} {group.orders.length === 1 ? "pedido" : "pedidos"}
                      {group.changeOutCents > 0 ? ` · lleva ${formatArs(group.changeOutCents)} de cambio` : ""}
                    </span>
                  </span>
                  <b className="tabular-nums">{formatArs(group.ordersCents)}</b>
                  {canSettle && (
                    <Button
                      type="button"
                      onClick={() => onDialog({ kind: "settle", group })}
                      className="min-h-10 rounded-xl px-3 text-sm"
                    >
                      Ingresar
                    </Button>
                  )}
                </div>
              ))
            )}
          </section>

          <section className="flex flex-col gap-2 rounded-2xl border border-line bg-white px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="m-0 whitespace-nowrap font-display text-lg font-extrabold">Movimientos ({current.movements.length})</h2>
              {canMovements && (
                <Button
                  type="button"
                  onClick={() => onDialog({ kind: "new" })}
                  className="min-h-10 shrink-0 whitespace-nowrap rounded-xl px-3 text-sm"
                >
                  Nuevo movimiento
                </Button>
              )}
            </div>
            <MovementList
              movements={current.movements}
              canManage={canMovements}
              onEdit={(movement) => onDialog({ kind: "edit", movement })}
              onVoid={(movement) => onDialog({ kind: "void", movement })}
            />
          </section>
        </div>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  tone,
  strong,
}: {
  label: ReactNode;
  value: string;
  tone?: "success" | "danger";
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-3 py-1.5 text-[15px]",
        strong && "mt-1 border-t border-line pt-2.5 font-extrabold",
      )}
    >
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

function VoidMovementDialog({ movement, onClose }: { movement: CashMovement; onClose: () => void }) {
  const mutation = useVoidCashMovement();
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      title="Anular movimiento"
      confirmLabel="Anular"
      danger
      pending={mutation.isPending}
      error={error}
      onCancel={onClose}
      onConfirm={() => {
        setError(null);
        mutation.mutate(movement.id, {
          onSuccess: onClose,
          onError: (err) => setError(cashErrorMessage(err)),
        });
      }}
    >
      ¿Seguro que querés anular “{movement.comment}”? Deja de sumar, pero queda en el historial.
    </ConfirmDialog>
  );
}
