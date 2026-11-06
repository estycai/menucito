import { useState } from "react";
import { formatArs, type CashCourierAccount } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cashErrorMessage, centsInput, pesosCents, useGiveCourierChange } from "@/lib/cash";

/** "Dar cambio a Juan": cash leaving the drawer so the expected follows. */
export function CourierChangeDialog({
  accounts,
  initialCourierId,
  onClose,
}: {
  accounts: readonly CashCourierAccount[];
  initialCourierId?: string | null;
  onClose: () => void;
}) {
  const mutation = useGiveCourierChange();
  const [courierId, setCourierId] = useState(initialCourierId ?? accounts[0]?.courier.memberId ?? "");
  const [amount, setAmount] = useState(centsInput(accounts.find((account) => account.courier.memberId === courierId)?.changeSuggestionCents));
  const [error, setError] = useState<string | null>(null);
  const account = accounts.find((candidate) => candidate.courier.memberId === courierId);
  const cents = pesosCents(amount);
  const invalid = typeof cents !== "number" || cents <= 0;

  function changeCourier(id: string) {
    setCourierId(id);
    const next = accounts.find((candidate) => candidate.courier.memberId === id);
    setAmount(centsInput(next?.changeSuggestionCents));
  }

  async function save() {
    setError(null);
    if (invalid || !courierId) return;
    try {
      await mutation.mutateAsync({ courierMemberId: courierId, amountCents: cents as number });
      onClose();
    } catch (err) {
      setError(cashErrorMessage(err));
    }
  }

  return (
    <Modal title="Dar cambio" size="sm" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-xs font-bold text-muted">
          Repartidor
          <select
            value={courierId}
            onChange={(event) => changeCourier(event.target.value)}
            className="box-border min-h-11 rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {accounts.map((candidate) => (
              <option key={candidate.courier.memberId} value={candidate.courier.memberId}>
                {candidate.courier.firstName} {candidate.courier.lastName}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-bold text-muted">
          Monto *
          <Input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
          {account && (
            <span className="font-normal text-muted">
              Sugerido: {formatArs(account.changeSuggestionCents)} de vuelto para sus pedidos en camino.
            </span>
          )}
        </label>

        {invalid && <p className="m-0 text-[13px] text-danger">Ingresá un monto mayor a $0.</p>}
        {error && <Notice tone="error">{error}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} className="px-5">
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={mutation.isPending || invalid || !courierId}
            onClick={() => void save()}
            className="min-h-12 rounded-xl px-5 text-[15px]"
          >
            {mutation.isPending ? "Guardando…" : "Dar cambio"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
