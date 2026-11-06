import { useEffect, useId, useRef, useState } from "react";
import {
  CASH_TENDERED_MAX_CENTS,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  PAYMENT_SPLIT_MESSAGES,
  formatArs,
  splitCashProblem,
  type OrderDetail,
  type PaymentMethod,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { useChangeOrderPaymentMethod } from "@/lib/orders";
import { ORDERS_UI_MESSAGES } from "@/lib/orders-messages";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { useBackdropClose } from "@/lib/backdrop-close";

/** Whole pesos typed in a cash field, in cents: `undefined` empty, `null` invalid. */
function pesosCents(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed) * 100;
}

/** Same fields as the public checkout: method, cash part of a split and "¿Con cuánto abonás?". */
export function OrderPaymentDialog({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const mutation = useChangeOrderPaymentMethod();
  const [method, setMethod] = useState<PaymentMethod>(order.paymentMethod);
  const [splitCash, setSplitCash] = useState(
    order.splitCashCents !== null ? String(order.splitCashCents / 100) : "",
  );
  const [cashTendered, setCashTendered] = useState(
    order.cashTenderedCents !== null ? String(order.cashTenderedCents / 100) : "",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  useScrollLock();

  // A tip only exists with transfer: switching to cash drops it and lowers the total.
  const tipRemoved = method === "cash" ? order.tipCents : 0;
  const totalCents = order.totalCents - tipRemoved;
  const splitCents = pesosCents(splitCash);
  const tenderedCents = pesosCents(cashTendered);

  let validationError: string | null = null;
  if (method === "split") {
    if (!splitCash.trim()) validationError = PAYMENT_SPLIT_MESSAGES.splitRequired;
    else if (typeof splitCents !== "number") validationError = PAYMENT_SPLIT_MESSAGES.splitInvalid;
    else {
      // The tip stays in the transfer part, so the cash must leave room for it.
      const splitProblem = splitCashProblem(splitCents, totalCents, order.tipCents);
      if (splitProblem) validationError = PAYMENT_SPLIT_MESSAGES[splitProblem];
    }
  }
  if (!validationError && tenderedCents !== null && tenderedCents !== undefined) {
    const cashCents = method === "cash" ? totalCents : (splitCents ?? 0);
    if (tenderedCents > CASH_TENDERED_MAX_CENTS) validationError = PAYMENT_SPLIT_MESSAGES.tenderedTooHigh;
    else if (tenderedCents < cashCents) validationError = PAYMENT_SPLIT_MESSAGES.tenderedTooLow;
  }
  if (!validationError && tenderedCents === null) validationError = PAYMENT_SPLIT_MESSAGES.tenderedInvalid;

  const save = async () => {
    setError(null);
    if (validationError) return;
    try {
      await mutation.mutateAsync({
        id: order.id,
        paymentMethod: method,
        ...(method === "split" && typeof splitCents === "number" ? { splitCashCents: splitCents } : {}),
        ...(method !== "transfer" && typeof tenderedCents === "number" ? { cashTenderedCents: tenderedCents } : {}),
        expectedStatus: order.status,
      });
      onClose();
    } catch {
      setError(ORDERS_UI_MESSAGES.updateFailed);
    }
  };

  const backdropClose = useBackdropClose(onClose);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      {...backdropClose}
      className="fixed inset-0 m-auto h-fit max-h-[90vh] w-full max-w-[520px] overflow-y-auto rounded-2xl border border-line bg-white p-5 text-ink shadow-2xl backdrop:bg-black/40 open:block sm:p-6"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
          <h2 id={titleId} className="m-0 font-display text-xl font-extrabold">
            Cambiar medio de pago
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-line text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
          >
            ✕
          </button>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-xs font-bold text-muted">Medio de pago</legend>
          {PAYMENT_METHODS.map((option) => (
            <label
              key={option}
              className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3.5 text-sm ${
                method === option ? "border-primary bg-primary-soft font-bold" : "border-line bg-white"
              }`}
            >
              <input
                type="radio"
                name="payment-method"
                value={option}
                checked={method === option}
                onChange={() => setMethod(option)}
                className="size-4 accent-primary"
              />
              {PAYMENT_LABELS[option]}
            </label>
          ))}
        </fieldset>

        {method === "split" && (
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            En efectivo
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={splitCash}
              onChange={(e) => setSplitCash(e.target.value)}
              className="box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
        )}

        {method !== "transfer" && (
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            ¿Con cuánto abona? <span className="font-normal">(opcional)</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={cashTendered}
              onChange={(e) => setCashTendered(e.target.value)}
              className="box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
        )}

        {method === "split" && typeof splitCents === "number" && splitCents > 0 && splitCents < totalCents && (
          <p className="m-0 text-sm text-muted">
            Por transferencia: <strong className="text-ink">{formatArs(totalCents - splitCents)}</strong>
          </p>
        )}

        {validationError && <p className="m-0 text-[13px] text-danger">{validationError}</p>}

        {tipRemoved > 0 && (
          <Notice tone="warning">
            Al pasar a efectivo se quita la propina ({formatArs(tipRemoved)}). El total queda en{" "}
            {formatArs(totalCents)}.
          </Notice>
        )}

        <p className="m-0 text-xs text-muted">
          Se puede cambiar mientras el pedido no esté pagado ni ingresado a la caja.
        </p>

        <Button
          type="button"
          disabled={mutation.isPending || Boolean(validationError)}
          onClick={() => void save()}
          className="min-h-11 w-full text-sm font-bold"
        >
          Guardar medio de pago
        </Button>
      </div>
    </dialog>
  );
}
