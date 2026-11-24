import { useState } from "react";
import {
  cashDifference,
  formatArs,
  formatCashDifference,
  type CashCloseResult,
  type CashCurrent,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cashErrorMessage, pesosCents, useCloseCash } from "@/lib/cash";

/** Close dialog: counted cash and real balance are mandatory (`0` is valid); without `cash.expected` both are blind. */
export function CloseCashDialog({
  current,
  canSeeExpected,
  onClose,
  onClosed,
}: {
  current: CashCurrent;
  canSeeExpected: boolean;
  onClose: () => void;
  onClosed: (result: CashCloseResult) => void;
}) {
  const mutation = useCloseCash();
  const [counted, setCounted] = useState("");
  const [countedTransfer, setCountedTransfer] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cents = pesosCents(counted);
  const transferCents = pesosCents(countedTransfer);
  const invalid = typeof cents !== "number";
  const transferInvalid = typeof transferCents !== "number";
  const expected = current.totals?.expectedCashCents ?? null;
  const expectedTransfer = current.totals?.expectedTransferCents ?? null;
  const difference = typeof cents === "number" && expected !== null ? cashDifference(cents, expected) : null;
  const transferDifference =
    typeof transferCents === "number" && expectedTransfer !== null
      ? cashDifference(transferCents, expectedTransfer)
      : null;
  const pending = current.toSettle;
  const pendingCount = pending.reduce((sum, group) => sum + group.orders.length, 0);
  const pendingCents = pending.reduce((sum, group) => sum + group.ordersCents, 0);

  async function save() {
    setError(null);
    if (invalid || transferInvalid) return;
    try {
      const result = await mutation.mutateAsync({
        countedCashCents: cents as number,
        countedTransferCents: transferCents as number,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onClosed(result);
    } catch (err) {
      setError(cashErrorMessage(err));
    }
  }

  return (
    <Modal title="Cerrar caja" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">
          {canSeeExpected
            ? "Contá el efectivo y mirá el saldo de la cuenta. Las diferencias se actualizan mientras escribís."
            : "Contá el efectivo y mirá el saldo de la cuenta. Las diferencias se ven después de cerrar."}
        </p>

        {pendingCount > 0 && (
          <Notice tone="warning">
            Quedan {pendingCount} {pendingCount === 1 ? "pedido" : "pedidos"} sin ingresar ({formatArs(pendingCents)}).
            Pasan a la próxima caja y podés cerrar igual.
          </Notice>
        )}

        <section className="flex flex-col gap-2 rounded-xl border border-line p-4">
          <h3 className="m-0 font-display text-lg font-extrabold">Caja efectivo</h3>
          {canSeeExpected && expected !== null && (
            <div className="flex justify-between text-sm">
              <span>Esperado</span>
              <span className="tabular-nums">{formatArs(expected)}</span>
            </div>
          )}
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Contado *
            <Input
              inputMode="numeric"
              value={counted}
              onChange={(event) => setCounted(event.target.value)}
              placeholder="0"
            />
            <span className="font-normal text-muted">Obligatorio. Si la caja está vacía, escribí 0.</span>
          </label>
          {canSeeExpected && difference && (
            <b className="text-base">{formatCashDifference(difference.cents)}</b>
          )}
        </section>

        <section className="flex flex-col gap-2 rounded-xl border border-line p-4">
          <h3 className="m-0 font-display text-lg font-extrabold">Caja transferencia</h3>
          {canSeeExpected && expectedTransfer !== null && (
            <div className="flex justify-between text-sm">
              <span>Esperado</span>
              <span className="tabular-nums">{formatArs(expectedTransfer)}</span>
            </div>
          )}
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Saldo real *
            <Input
              inputMode="numeric"
              value={countedTransfer}
              onChange={(event) => setCountedTransfer(event.target.value)}
              placeholder="0"
            />
            <span className="font-normal text-muted">Obligatorio. Si la cuenta está vacía, escribí 0.</span>
          </label>
          {canSeeExpected && transferDifference && (
            <b className="text-base">{formatCashDifference(transferDifference.cents)}</b>
          )}
        </section>

        <label className="flex flex-col gap-1 text-xs font-bold text-muted">
          Nota de cierre <span className="font-normal">(opcional)</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={200}
            rows={3}
            placeholder="Ej.: faltó el vuelto de un pedido"
            className="box-border w-full rounded-xl border border-line bg-white p-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <span className="self-end font-normal text-muted">{note.length}/200</span>
        </label>

        {(counted.trim() !== "" && cents === null) || (countedTransfer.trim() !== "" && transferCents === null) ? (
          <p className="m-0 text-[13px] text-danger">Ingresá montos enteros en las dos cajas.</p>
        ) : null}
        {error && <Notice tone="error">{error}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} className="px-5">
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={mutation.isPending || invalid || transferInvalid}
            onClick={() => void save()}
            className="min-h-12 rounded-xl bg-danger px-5 text-[15px] hover:bg-danger/90"
          >
            {mutation.isPending ? "Cerrando…" : "Cerrar caja"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
