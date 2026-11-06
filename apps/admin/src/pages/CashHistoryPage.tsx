import { useState } from "react";
import { Link } from "react-router";
import { formatArs, formatCashDifference, formatLocalDateTime } from "@menucito/shared";
import { QueryError } from "@/components/QueryError";
import { Button } from "@/components/ui/button";
import { CASH_UI_MESSAGES, useCashHistory } from "@/lib/cash";
import { useDocumentTitle } from "@/lib/use-document-title";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

/** "Historial de arqueos": closed sessions, newest first, each one immutable. */
export function CashHistoryPage() {
  useDocumentTitle("Historial de arqueos");
  const [page, setPage] = useState(1);
  const query = useCashHistory(page, PAGE_SIZE);
  const data = query.data;
  const lastPage = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Historial de arqueos</h1>
          <span className="text-sm text-muted">Cada cierre queda guardado y no cambia después.</span>
        </div>
        <Button asChild variant="outline" className="px-4 text-sm font-bold">
          <Link to="/cajas">Volver a la caja</Link>
        </Button>
      </div>

      {query.isError ? (
        <QueryError message={CASH_UI_MESSAGES.historyFailed} onRetry={() => void query.refetch()} />
      ) : query.isLoading || !data ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">Cargando el historial...</div>
      ) : data.sessions.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">
          Todavía no cerraste ninguna caja.
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white md:block">
            <table className="w-full border-collapse text-left text-[15px]">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="px-4 py-3.5 font-bold">Apertura de caja</th>
                  <th className="px-4 py-3.5 font-bold">Cierre de caja</th>
                  <th className="px-4 py-3.5 text-right font-bold">Esperado</th>
                  <th className="px-4 py-3.5 text-right font-bold">Contado</th>
                  <th className="px-4 py-3.5 font-bold">Diferencia</th>
                  <th className="px-4 py-3.5 text-right font-bold">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.sessions.map((session) => (
                  <tr key={session.id}>
                    <td className="px-4 py-3.5">
                      <b>{formatLocalDateTime(session.openedAt)}</b>
                      <br />
                      <span className="text-[13px] text-muted">por {session.openedByName}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <b>{session.closedAt !== null ? formatLocalDateTime(session.closedAt) : "—"}</b>
                      <br />
                      <span className="text-[13px] text-muted">por {session.closedByName ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums">{formatArs(session.expectedCashCents ?? 0)}</td>
                    <td className="px-4 py-3.5 text-right tabular-nums">{formatArs(session.countedCashCents ?? 0)}</td>
                    <td className="px-4 py-3.5">
                      <DifferencePill difference={session.differenceCents ?? 0} />
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <Button asChild variant="outline" className="mr-2 min-h-10 px-3 text-sm">
                        <Link to={`/cajas/${session.id}`}>Ver detalle</Link>
                      </Button>
                      <Button asChild variant="outline" className="min-h-10 px-3 text-sm">
                        <Link to={`/cajas/${session.id}/imprimir`}>Imprimir</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 md:hidden">
            {data.sessions.map((session) => (
              <article key={session.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <b>{formatLocalDateTime(session.openedAt)}</b>
                  <DifferencePill difference={session.differenceCents ?? 0} />
                </div>
                <span className="text-[13px] text-muted">
                  Cerró {session.closedByName ?? "—"} · {session.closedAt !== null ? formatLocalDateTime(session.closedAt) : "—"}
                </span>
                <div className="flex justify-between text-sm">
                  <span>Esperado {formatArs(session.expectedCashCents ?? 0)}</span>
                  <span>Contado {formatArs(session.countedCashCents ?? 0)}</span>
                </div>
                <div className="mt-1 flex gap-2">
                  <Button asChild variant="outline" className="min-h-10 flex-1 px-3 text-sm">
                    <Link to={`/cajas/${session.id}`}>Ver detalle</Link>
                  </Button>
                  <Button asChild variant="outline" className="min-h-10 flex-1 px-3 text-sm">
                    <Link to={`/cajas/${session.id}/imprimir`}>Imprimir</Link>
                  </Button>
                </div>
              </article>
            ))}
          </div>

          <nav aria-label="Páginas" className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">
              Página {data.page} de {lastPage} · {data.total} {data.total === 1 ? "arqueo" : "arqueos"}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1 || query.isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="min-h-11 px-4 text-sm"
              >
                Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={page >= lastPage || query.isFetching}
                onClick={() => setPage((current) => current + 1)}
                className="min-h-11 px-4 text-sm"
              >
                Siguiente
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

function DifferencePill({ difference }: { difference: number }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap",
        difference > 0
          ? "bg-success-soft text-success"
          : difference < 0
            ? "bg-danger-soft text-danger"
            : "bg-tab text-muted",
      )}
    >
      {formatCashDifference(difference)}
    </span>
  );
}
