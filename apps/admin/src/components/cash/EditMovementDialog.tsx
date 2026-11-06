import { useState } from "react";
import { CASH_MESSAGES, type CashMovement, type CashPaymentMethod, type UpdateCashMovementInput } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cashErrorMessage, centsInput, pesosCents, useUpdateCashMovement } from "@/lib/cash";
import { cn } from "@/lib/utils";

const METHODS: CashPaymentMethod[] = ["cash", "transfer", "split"];

/** Edits the amount, method and comment of a hand-made movement; totals are recalculated by the API. */
export function EditMovementDialog({ movement, onClose }: { movement: CashMovement; onClose: () => void }) {
  const mutation = useUpdateCashMovement();
  const [method, setMethod] = useState<CashPaymentMethod>(movement.method);
  const [amount, setAmount] = useState(centsInput(movement.method === "split" ? null : movement.amountCents));
  const [cash, setCash] = useState(centsInput(movement.cashCents));
  const [transfer, setTransfer] = useState(centsInput(movement.transferCents));
  const [comment, setComment] = useState(movement.comment);
  const [error, setError] = useState<string | null>(null);

  const amountCents = pesosCents(amount);
  const cashCents = pesosCents(cash);
  const transferCents = pesosCents(transfer);
  let validation: string | null = null;
  if (method === "split") {
    if (typeof cashCents !== "number" || typeof transferCents !== "number") validation = CASH_MESSAGES.splitAmounts;
    else if (cashCents <= 0 || transferCents <= 0) validation = CASH_MESSAGES.splitBothPositive;
  } else if (typeof amountCents !== "number" || amountCents <= 0) {
    validation = CASH_MESSAGES.amountInvalid;
  }

  const methods = movement.kind === "courier_payment" ? METHODS.filter((value) => value !== "split") : METHODS;

  async function save() {
    setError(null);
    if (validation) return;
    const input: UpdateCashMovementInput = {
      method,
      ...(method === "split"
        ? { cashCents: cashCents as number, transferCents: transferCents as number }
        : { amountCents: amountCents as number }),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    };
    try {
      await mutation.mutateAsync({ id: movement.id, ...input });
      onClose();
    } catch (err) {
      setError(cashErrorMessage(err));
    }
  }

  return (
    <Modal title="Editar movimiento" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 text-xs font-bold text-muted">Método de pago</legend>
          <div className="flex rounded-xl bg-tab p-1">
            {methods.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={method === value}
                onClick={() => setMethod(value)}
                className={cn(
                  "min-h-10 flex-1 cursor-pointer rounded-lg px-2 text-sm",
                  method === value ? "bg-white font-bold text-ink shadow-sm" : "text-muted",
                )}
              >
                {value === "cash" ? "Efectivo" : value === "transfer" ? "Transferencia" : "Dividir pago"}
              </button>
            ))}
          </div>
        </fieldset>

        {method === "split" ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-bold text-muted">
              Efectivo
              <Input inputMode="numeric" value={cash} onChange={(event) => setCash(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-muted">
              Transferencia
              <Input inputMode="numeric" value={transfer} onChange={(event) => setTransfer(event.target.value)} />
            </label>
          </div>
        ) : (
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Monto *
            <Input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
        )}

        <label className="flex flex-col gap-1 text-xs font-bold text-muted">
          Comentarios <span className="font-normal">(opcional)</span>
          <Input value={comment} onChange={(event) => setComment(event.target.value)} maxLength={200} />
        </label>

        {validation && <p className="m-0 text-[13px] text-danger">{validation}</p>}
        {error && <Notice tone="error">{error}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} className="px-5">
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={mutation.isPending || Boolean(validation)}
            onClick={() => void save()}
            className="min-h-12 rounded-xl px-5 text-[15px]"
          >
            {mutation.isPending ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
