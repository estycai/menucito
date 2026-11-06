import { formatArs, formatLocalTime, type CashMovement } from "@menucito/shared";
import { Badge } from "@/components/ui/badge";
import { movementSign } from "@/lib/cash";
import { cn } from "@/lib/utils";
import { movementMethodText } from "@/lib/cash-labels";

const EDITABLE_KINDS = new Set(["income", "expense", "courier_payment"]);

/** Movements newest first; automatic split incomes and voided rows carry their own mark. */
export function MovementList({
  movements,
  canManage,
  onEdit,
  onVoid,
}: {
  movements: readonly CashMovement[];
  canManage: boolean;
  onEdit: (movement: CashMovement) => void;
  onVoid: (movement: CashMovement) => void;
}) {
  if (movements.length === 0) {
    return <p className="m-0 py-4 text-sm text-muted">Todavía no hay movimientos en este turno.</p>;
  }

  return (
    <ul className="m-0 list-none p-0">
      {movements.map((movement) => {
        const sign = movementSign(movement.kind);
        const voided = movement.voidedAt !== null;
        const positive = sign === "+";
        return (
          <li key={movement.id} className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full font-extrabold",
                voided
                  ? "bg-tab text-muted"
                  : positive
                    ? "bg-success-soft text-success"
                    : "bg-danger-soft text-danger",
              )}
            >
              {sign}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn("text-[15px] font-bold", voided && "text-muted line-through")}>{movement.comment}</span>
              <span className="text-[13px] text-muted">
                {[movementMethodText(movement), formatLocalTime(movement.createdAt), `cargó ${movement.createdByName}`]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {(movement.automatic || movement.editedAt !== null || voided) && (
                <span className="flex flex-wrap gap-1.5">
                  {movement.automatic && <Badge tone="subtle">Automático</Badge>}
                  {movement.editedAt !== null && !voided && (
                    <Badge tone="warning">
                      Editado por {movement.editedByName ?? ""} · {formatLocalTime(movement.editedAt)}
                    </Badge>
                  )}
                  {voided && movement.voidedAt !== null && (
                    <Badge tone="subtle">
                      Anulado por {movement.voidedByName ?? ""} · {formatLocalTime(movement.voidedAt)}
                    </Badge>
                  )}
                </span>
              )}
            </div>
            <span
              className={cn(
                "shrink-0 font-bold tabular-nums",
                voided ? "text-muted line-through" : positive ? "text-success" : "text-danger",
              )}
            >
              {sign}
              {formatArs(movement.amountCents)}
            </span>
            {canManage && !movement.automatic && !voided ? (
              <details className="relative shrink-0">
                <summary
                  aria-label="Editar o anular"
                  className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg text-muted hover:text-ink"
                >
                  ⋯
                </summary>
                <div className="absolute right-0 z-10 mt-1 flex min-w-36 flex-col rounded-xl border border-line bg-white p-1 shadow-lg">
                  {EDITABLE_KINDS.has(movement.kind) && (
                    <button
                      type="button"
                      onClick={() => onEdit(movement)}
                      className="min-h-10 cursor-pointer rounded-lg px-3 text-left text-sm hover:bg-bg"
                    >
                      Editar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onVoid(movement)}
                    className="min-h-10 cursor-pointer rounded-lg px-3 text-left text-sm text-danger hover:bg-danger/10"
                  >
                    Anular
                  </button>
                </div>
              </details>
            ) : (
              <span className="w-11" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
