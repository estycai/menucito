import { Link } from "react-router";
import {
  formatArs,
  formatCashDifference,
  formatLocalDateTime,
  type CashCloseResult,
} from "@menucito/shared";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Result of a close: difference in words, what passed to the next cash and where to go next. */
export function CloseResultDialog({ result, onClose }: { result: CashCloseResult; onClose: () => void }) {
  const session = result.detail.session;
  const difference = session.differenceCents ?? 0;
  const pendingCount = result.pending.count;

  return (
    <Modal title="Caja cerrada" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted">
            Cerró {session.closedByName ?? ""}
            {session.closedAt !== null ? ` · ${formatLocalDateTime(session.closedAt)}` : ""}
          </span>
          <h3 className="m-0 font-display text-xl font-extrabold">Arqueo del {formatLocalDateTime(session.openedAt).slice(0, 10)}</h3>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-line p-4">
            <span className="text-[13px] text-muted">Esperado en caja</span>
            <b className="block font-display text-xl tabular-nums">{formatArs(session.expectedCashCents ?? 0)}</b>
          </div>
          <div className="rounded-xl border border-line p-4">
            <span className="text-[13px] text-muted">Contado</span>
            <b className="block font-display text-xl tabular-nums">{formatArs(session.countedCashCents ?? 0)}</b>
          </div>
        </div>

        <div
          role="status"
          className={cn(
            "flex items-center gap-3 rounded-xl border p-4",
            difference > 0
              ? "border-success/30 bg-success-soft text-success"
              : difference < 0
                ? "border-danger/30 bg-danger-soft text-danger"
                : "border-line bg-bg text-muted",
          )}
        >
          <b className="text-lg">{formatCashDifference(difference)}</b>
        </div>

        <div className="flex justify-between text-sm">
          <span>Transferencias del turno</span>
          <span className="tabular-nums">{formatArs(result.detail.totals.transfer.totalCents ?? 0)}</span>
        </div>

        {pendingCount > 0 && (
          <p className="m-0 text-[13px] text-muted">
            Pasan a la próxima caja: {pendingCount} {pendingCount === 1 ? "pedido" : "pedidos"} ({formatArs(result.pending.totalCents)}).
          </p>
        )}
        {session.closeNote && <p className="m-0 text-sm text-muted">Nota: {session.closeNote}</p>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button asChild variant="outline" className="px-5">
            <Link to={`/cajas/${session.id}/imprimir`}>Imprimir</Link>
          </Button>
          <Button asChild className="min-h-12 rounded-xl px-5 text-[15px]">
            <Link to={`/cajas/${session.id}`}>Ver arqueo</Link>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
