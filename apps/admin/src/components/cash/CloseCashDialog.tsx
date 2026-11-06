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

/** Close dialog: counted cash is mandatory (`0` is valid); without `cash.expected` the difference is blind. */
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
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cents = pesosCents(counted);
  const invalid = typeof cents !== "number";
  const expected = current.totals?.expectedCashCents ?? null;
  const difference = typeof cents === "number" && expected !== null ? cashDifference(cents, expected) : null;
  const pending = current.toSettle;
  const pendingCount = pending.reduce((sum, group) => sum + group.orders.length, 0);
  const pendingCents = pending.reduce((sum, group) => sum + group.ordersCents, 0);

  async function save() {
    setError(null);
    if (invalid) return;
    try {
      const result = await mutation.mutateAsync({
        countedCashCents: cents as number,
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
            ? "Contá el efectivo de la caja. La diferencia se actualiza mientras escribís."
            : "Contá el efectivo de la caja. La diferencia se ve después de cerrar."}
        </p>

        {pendingCount > 0 && (
          <Notice tone="warning">
            Quedan {pendingCount} {pendingCount === 1 ? "pedido" : "pedidos"} sin ingresar ({formatArs(pendingCents)}).
            Pasan a la próxima caja y podés cerrar igual.
          </Notice>
        )}

        <label className="flex flex-col gap-1 text-xs font-bold text-muted">
          Efectivo contado *
          <Input inputMode="numeric" value={counted} onChange={(event) => setCounted(event.target.value)} placeholder="0" />
          <span className="font-normal text-muted">Obligatorio. Si la caja está vacía, escribí 0.</span>
        </label>

        {canSeeExpected && expected !== null && (
          <div className="rounded-xl bg-bg p-4 text-sm">
            <div className="flex justify-between py-1">
              <span>Esperado en caja</span>
              <span className="tabular-nums">{formatArs(expected)}</span>
            </div>
            {difference && (
              <div className="pt-2 text-base font-extrabold">{formatCashDifference(difference.cents)}</div>
            )}
          </div>
        )}

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

        <p className="m-0 text-[13px] text-muted">Las transferencias no se cuentan: se ven en el banco.</p>
        {invalid && counted.trim() !== "" && <p className="m-0 text-[13px] text-danger">Ingresá un monto entero.</p>}
        {error && <Notice tone="error">{error}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} className="px-5">
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={mutation.isPending || invalid}
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
