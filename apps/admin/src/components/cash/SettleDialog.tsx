import { useState } from "react";
import { formatLocalTime, formatArs, type CashSettlementGroup } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cashErrorMessage, centsInput, pesosCents, useSettleOrders } from "@/lib/cash";

/** "Ingresar pedidos de Juan": the cash orders of a courier plus the change that comes back. */
export function SettleDialog({ group, onClose }: { group: CashSettlementGroup; onClose: () => void }) {
  const mutation = useSettleOrders();
  const name = group.courier ? `${group.courier.firstName} ${group.courier.lastName}`.trim() : "sin repartidor";
  const [selected, setSelected] = useState<Set<string>>(() => new Set(group.orders.map((order) => order.id)));
  const [changeBack, setChangeBack] = useState(centsInput(group.changeOutCents));
  const [error, setError] = useState<string | null>(null);

  const chosen = group.orders.filter((order) => selected.has(order.id));
  const ordersCents = chosen.reduce((sum, order) => sum + order.cashCents, 0);
  const changeCents = pesosCents(changeBack);
  const totalCents = ordersCents + (typeof changeCents === "number" ? changeCents : 0);
  const invalidChange = changeCents === null;

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setError(null);
    if (chosen.length === 0 || invalidChange) return;
    try {
      await mutation.mutateAsync({
        orderIds: chosen.map((order) => order.id),
        ...(typeof changeCents === "number" && changeCents > 0 ? { changeBackCents: changeCents } : {}),
      });
      onClose();
    } catch (err) {
      setError(cashErrorMessage(err));
    }
  }

  return (
    <Modal title={`Ingresar pedidos de ${name}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">Entregados en efectivo que todavía no están en la caja.</p>
        <ul className="m-0 list-none divide-y divide-line-soft p-0">
          {group.orders.map((order) => (
            <li key={order.id} className="flex items-center gap-3 py-3">
              <input
                type="checkbox"
                checked={selected.has(order.id)}
                onChange={() => toggle(order.id)}
                aria-label={`Incluir pedido #${order.number}`}
                className="size-5 accent-primary"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="text-sm">
                  Pedido #{order.number} · {order.customerName}
                </b>
                <span className="text-[13px] text-muted">
                  {order.paymentMethod === "split" ? "Dividir pago" : "Efectivo"}
                  {order.deliveredAt !== null ? ` · entregado ${formatLocalTime(order.deliveredAt)}` : ""}
                </span>
                {order.paymentMethod === "split" && (
                  <span className="text-[13px] text-muted">
                    Cobró {formatArs(order.cashCents)} en efectivo; {formatArs(order.transferCents)} por transferencia
                    entran como ingreso.
                  </span>
                )}
              </span>
              <b className="tabular-nums">{formatArs(order.cashCents)}</b>
            </li>
          ))}
        </ul>

        <label className="flex flex-col gap-1 text-xs font-bold text-muted">
          Vuelve cambio
          <Input inputMode="numeric" value={changeBack} onChange={(event) => setChangeBack(event.target.value)} />
          <span className="font-normal text-muted">
            {name} {group.changeOutCents > 0 ? `salió con ${formatArs(group.changeOutCents)} de cambio.` : "no tiene cambio pendiente."}
            {" "}Corregilo si trae otro monto.
          </span>
        </label>

        <div className="rounded-xl bg-bg p-4 text-sm">
          <div className="flex justify-between py-1">
            <span>Pedidos ({chosen.length})</span>
            <span className="tabular-nums">{formatArs(ordersCents)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span>Cambio que vuelve</span>
            <span className="tabular-nums">{formatArs(typeof changeCents === "number" ? changeCents : 0)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-line pt-3 text-base font-extrabold">
            <span>Entra a la caja</span>
            <span className="tabular-nums">{formatArs(totalCents)}</span>
          </div>
        </div>

        {chosen.length === 0 && <p className="m-0 text-[13px] text-danger">Elegí al menos un pedido.</p>}
        {invalidChange && <p className="m-0 text-[13px] text-danger">El cambio tiene que ser un monto entero.</p>}
        {error && <Notice tone="error">{error}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} className="px-5">
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={mutation.isPending || chosen.length === 0 || invalidChange}
            onClick={() => void save()}
            className="min-h-12 rounded-xl px-5 text-[15px]"
          >
            {mutation.isPending ? "Ingresando…" : "Ingresar a la caja"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
