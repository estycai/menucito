import { useState } from "react";
import {
  CASH_METHOD_LABELS,
  CASH_MESSAGES,
  formatArs,
  type CashCurrent,
  type CashPaymentMethod,
  type CreateCashMovementInput,
  type ManualCashMovementKind,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cashErrorMessage, centsInput, pesosCents, useCreateCashMovement } from "@/lib/cash";
import { cn } from "@/lib/utils";

const KINDS: { id: ManualCashMovementKind; label: string }[] = [
  { id: "income", label: "Ingreso" },
  { id: "expense", label: "Egreso" },
  { id: "courier_payment", label: "Pago a repartidor" },
];

const METHODS: CashPaymentMethod[] = ["cash", "transfer", "split"];

function Segment({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1 text-xs font-bold text-muted">{label}</legend>
      <div className="flex rounded-xl bg-tab p-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
            className={cn(
              "min-h-10 flex-1 cursor-pointer rounded-lg px-2 text-sm",
              value === option.id ? "bg-white font-bold text-ink shadow-sm" : "text-muted",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** "Nuevo movimiento": income, expense or payment to a courier, in cash, transfer or split. */
export function NewMovementDialog({
  current,
  initialCourierId,
  onClose,
}: {
  current: CashCurrent;
  initialCourierId?: string | null;
  onClose: () => void;
}) {
  const mutation = useCreateCashMovement();
  const startsAsPayment = Boolean(initialCourierId);
  const initialCourier = initialCourierId ?? current.courierAccounts[0]?.courier.memberId ?? "";
  const initialAccount = current.courierAccounts.find((candidate) => candidate.courier.memberId === initialCourier);
  const [kind, setKind] = useState<ManualCashMovementKind>(startsAsPayment ? "courier_payment" : "income");
  const [method, setMethod] = useState<CashPaymentMethod>("cash");
  const [amount, setAmount] = useState(startsAsPayment ? centsInput(initialAccount?.suggestedCents) : "");
  const [cash, setCash] = useState("");
  const [transfer, setTransfer] = useState("");
  const [courierId, setCourierId] = useState(initialCourier);
  const [comment, setComment] = useState(
    startsAsPayment && (initialAccount?.suggestedCents ?? 0) > 0 ? "Envíos y propinas" : "",
  );
  const [error, setError] = useState<string | null>(null);

  const account = current.courierAccounts.find((candidate) => candidate.courier.memberId === courierId);

  /** The amount starts at the courier suggestion; it stays editable afterwards. */
  function changeKind(id: ManualCashMovementKind) {
    setKind(id);
    if (id !== "courier_payment") return;
    if (method === "split") setMethod("cash");
    setAmount(centsInput(account?.suggestedCents));
    setComment((account?.suggestedCents ?? 0) > 0 ? "Envíos y propinas" : "");
  }

  function changeCourier(id: string) {
    setCourierId(id);
    const next = current.courierAccounts.find((candidate) => candidate.courier.memberId === id);
    setAmount(centsInput(next?.suggestedCents));
    setComment((next?.suggestedCents ?? 0) > 0 ? "Envíos y propinas" : "");
  }

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
  if (kind === "courier_payment" && !courierId) validation = CASH_MESSAGES.courierRequired;
  // The red message waits until an amount is typed: an empty form only keeps the button disabled.
  const amountTyped = method === "split" ? cash.trim() !== "" || transfer.trim() !== "" : amount.trim() !== "";
  const visibleValidation = amountTyped || (kind === "courier_payment" && !courierId) ? validation : null;

  async function save() {
    setError(null);
    if (validation) return;
    const input: CreateCashMovementInput = {
      kind,
      method,
      ...(method === "split"
        ? { cashCents: cashCents as number, transferCents: transferCents as number }
        : { amountCents: amountCents as number }),
      ...(kind === "courier_payment" ? { courierMemberId: courierId } : {}),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    };
    try {
      await mutation.mutateAsync(input);
      onClose();
    } catch (err) {
      setError(cashErrorMessage(err));
    }
  }

  return (
    <Modal title="Nuevo movimiento" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Segment options={KINDS} value={kind} onChange={(id) => changeKind(id as ManualCashMovementKind)} label="Tipo de movimiento" />

        {kind === "courier_payment" && (
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Repartidor
            <select
              value={courierId}
              onChange={(event) => changeCourier(event.target.value)}
              className="box-border min-h-11 rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              {current.courierAccounts.map((candidate) => (
                <option key={candidate.courier.memberId} value={candidate.courier.memberId}>
                  {candidate.courier.firstName} {candidate.courier.lastName}
                </option>
              ))}
            </select>
          </label>
        )}

        <Segment
          options={METHODS.filter((value) => kind !== "courier_payment" || value !== "split").map((value) => ({
            id: value,
            label: CASH_METHOD_LABELS[value],
          }))}
          value={method}
          onChange={(id) => setMethod(id as CashPaymentMethod)}
          label="Método de pago"
        />

        {method === "split" ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-bold text-muted">
              Efectivo
              <Input inputMode="numeric" value={cash} onChange={(event) => setCash(event.target.value)} placeholder="0" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-muted">
              Transferencia
              <Input inputMode="numeric" value={transfer} onChange={(event) => setTransfer(event.target.value)} placeholder="0" />
            </label>
          </div>
        ) : (
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Monto *
            <Input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
            {kind === "courier_payment" && account && (
              <span className="font-normal text-muted">
                Sugerido: envíos {formatArs(account.shippingCents)} + propinas {formatArs(account.tipCents)}. Podés cambiarlo.
              </span>
            )}
          </label>
        )}

        <label className="flex flex-col gap-1 text-xs font-bold text-muted">
          Comentarios <span className="font-normal">(opcional)</span>
          <Input value={comment} onChange={(event) => setComment(event.target.value)} maxLength={200} />
        </label>

        {visibleValidation && <p className="m-0 text-[13px] text-danger">{visibleValidation}</p>}
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
            {mutation.isPending ? "Guardando…" : kind === "courier_payment" ? "Registrar pago" : "Registrar movimiento"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
