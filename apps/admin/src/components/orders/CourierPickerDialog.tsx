import { useId, useState } from "react";
import { Link } from "react-router";
import { formatArs, type OrderStatus } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { Modal } from "@/components/Modal";
import { QueryError } from "@/components/QueryError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/lib/access";
import { ApiError } from "@/lib/restaurant";
import { assignFailureMessage, courierName, inProgressText, useCouriers } from "@/lib/couriers";
import { useAssignCourier } from "@/lib/orders";
import { cn } from "@/lib/utils";

const COURIERS_LOAD_FAILED = "No pudimos cargar los repartidores.";

interface CourierPickerOrder {
  id: string;
  number: number;
  customerName: string;
  totalCents: number;
  /** Address of a delivery order; the board summary does not carry it, so it is optional. */
  deliveryAddress?: string | null;
}

interface CourierPickerDialogProps {
  order: CourierPickerOrder;
  /** `ready` assigns and sends the order; `sent` only changes the courier (change 13, decision 7). */
  status: OrderStatus;
  /** The courier already on the order, kept out of the list when reassigning. */
  currentCourierId?: string | null;
  onClose: () => void;
  /** Called once the API confirmed the assignment. */
  onAssigned: () => void;
}

/**
 * "¿Quién lo lleva?" selector (change 13 scenario 39): the active couriers with their orders on the
 * way, one of them picked to send a Ready order or to change the courier of a sent one.
 */
export function CourierPickerDialog({
  order,
  status,
  currentCourierId = null,
  onClose,
  onAssigned,
}: CourierPickerDialogProps) {
  const groupName = useId();
  const { isOwner } = useAccess();
  const couriersQuery = useCouriers();
  const assignMutation = useAssignCourier();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const all = couriersQuery.data ?? [];
  const couriers = all.filter((courier) => courier.memberId !== currentCourierId);
  const subtitleParts = [`Pedido #${order.number}`, order.customerName];
  if (order.deliveryAddress) subtitleParts.push(order.deliveryAddress);
  subtitleParts.push(formatArs(order.totalCents));

  async function handleAssign() {
    if (!selectedId) return;
    setErrorMsg(null);
    try {
      await assignMutation.mutateAsync({ id: order.id, courierMemberId: selectedId });
      onAssigned();
    } catch (error) {
      setErrorMsg(assignFailureMessage(error));
      // The picked courier was deactivated or unmarked meanwhile: reload the list without it.
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
        setSelectedId(null);
        void couriersQuery.refetch();
      }
    }
  }

  return (
    <Modal title="¿Quién lo lleva?" size="sm" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">{subtitleParts.join(" · ")}</p>

        {errorMsg && <Notice tone="error">{errorMsg}</Notice>}

        {couriersQuery.isLoading ? (
          <div className="py-6 text-center text-muted">Cargando repartidores...</div>
        ) : couriersQuery.isError ? (
          <QueryError
            message={COURIERS_LOAD_FAILED}
            onRetry={() => void couriersQuery.refetch()}
            retrying={couriersQuery.isRefetching}
          />
        ) : couriers.length === 0 ? (
          <p className="m-0 rounded-xl border border-line bg-bg/50 p-3 text-sm text-muted">
            {all.length === 0 ? (
              <>
                Todavía no hay repartidores. Marcá a alguien como repartidor en{" "}
                {isOwner ? (
                  <Link to="/usuarios" className="font-bold text-link hover:underline">
                    Usuarios
                  </Link>
                ) : (
                  "Usuarios"
                )}
                .
              </>
            ) : (
              "No hay otros repartidores activos para cambiar el pedido."
            )}
          </p>
        ) : (
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="sr-only">Repartidor</legend>
            {couriers.map((courier) => {
              const selected = selectedId === courier.memberId;
              return (
                <label
                  key={courier.memberId}
                  className={cn(
                    "box-border flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3.5 transition-colors",
                    selected ? "border-2 border-primary bg-primary-soft" : "border-line bg-white hover:bg-bg/50",
                  )}
                >
                  <input
                    type="radio"
                    name={groupName}
                    value={courier.memberId}
                    checked={selected}
                    onChange={() => setSelectedId(courier.memberId)}
                    className="size-5 accent-primary"
                  />
                  <span className="flex-1 text-[15px] font-bold text-ink">{courierName(courier)}</span>
                  <Badge tone={courier.inProgressOrders === 0 ? "success" : "sent"}>
                    {inProgressText(courier.inProgressOrders)}
                  </Badge>
                </label>
              );
            })}
          </fieldset>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={assignMutation.isPending} onClick={onClose} className="px-5">
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!selectedId || assignMutation.isPending}
            onClick={handleAssign}
            className="px-5"
          >
            {assignMutation.isPending
              ? "Asignando..."
              : status === "ready"
                ? "Asignar y pasar a Enviado"
                : "Asignar repartidor"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
