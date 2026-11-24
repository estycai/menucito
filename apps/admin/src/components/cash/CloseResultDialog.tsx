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

        <DifferenceBox
          title="Caja efectivo"
          expectedCents={session.expectedCashCents ?? 0}
          countedLabel="Contado"
          countedCents={session.countedCashCents ?? 0}
          differenceCents={session.differenceCents ?? 0}
        />
        <DifferenceBox
          title="Caja transferencia"
          expectedCents={session.expectedTransferCents ?? 0}
          countedLabel="Saldo real"
          countedCents={session.countedTransferCents ?? 0}
          differenceCents={session.transferDifferenceCents ?? 0}
        />

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

function DifferenceBox({
  title,
  expectedCents,
  countedLabel,
  countedCents,
  differenceCents,
}: {
  title: string;
  expectedCents: number;
  countedLabel: string;
  countedCents: number;
  differenceCents: number;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
      <b className="font-display text-base font-extrabold">{title}</b>
      <div className="flex justify-between text-sm">
        <span className="text-muted">Esperado</span>
        <span className="tabular-nums">{formatArs(expectedCents)}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-muted">{countedLabel}</span>
        <span className="tabular-nums">{formatArs(countedCents)}</span>
      </div>
      <div
        role="status"
        className={cn(
          "mt-1 rounded-lg border p-2 text-center font-bold",
          differenceCents > 0
            ? "border-success/30 bg-success-soft text-success"
            : differenceCents < 0
              ? "border-danger/30 bg-danger-soft text-danger"
              : "border-line bg-bg text-muted",
        )}
      >
        {formatCashDifference(differenceCents)}
      </div>
    </div>
  );
}
