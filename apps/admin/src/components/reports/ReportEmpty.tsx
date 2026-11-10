import { useState } from "react";
import { Link } from "react-router";
import { localDateKey, type ReportRange } from "@menucito/shared";

interface ReportEmptyProps {
  range: ReportRange;
  /** Without the date filter there is no other period to offer. */
  canSeeDate: boolean;
  onLast7Days?: () => void;
  /** What the tab reports: the empty message and the link at the end (change 16c). */
  kind?: "sales" | "couriers" | "cash";
}

const COPY = {
  sales: {
    title: (today: boolean, oneDay: boolean) =>
      today ? "Todavía no hay ventas hoy" : oneDay ? "No hubo ventas ese día" : "No hubo ventas en este período",
    description: "Los pedidos entregados y pagados del período aparecen acá. Probá con más días o mirá los pedidos.",
    link: "/pedidos",
    linkLabel: "Ir a Pedidos",
  },
  couriers: {
    title: (today: boolean, oneDay: boolean) =>
      today
        ? "Todavía no hay envíos con repartidor hoy"
        : oneDay
          ? "No hubo envíos con repartidor ese día"
          : "No hubo envíos con repartidor en este período",
    description: "Los pedidos delivery entregados, pagados y con repartidor asignado aparecen acá. Probá con más días.",
    link: "/pedidos",
    linkLabel: "Ir a Pedidos",
  },
  cash: {
    title: (today: boolean, oneDay: boolean) =>
      today ? "Todavía no hay arqueos hoy" : oneDay ? "No hubo arqueos ese día" : "No hubo arqueos en este período",
    description: "Las cajas abiertas y cerradas del período aparecen acá. Probá con más días o abrí una caja.",
    link: "/cajas",
    linkLabel: "Ir a Cajas",
  },
} as const;

/** "No hubo ventas" of a Reports tab: the same message in Evolución, Facturación and Ventas. */
export function ReportEmpty({ range, canSeeDate, onLast7Days, kind = "sales" }: ReportEmptyProps) {
  const [todayKey] = useState(() => localDateKey(Date.now()));
  const oneDay = range.from === range.to;
  const today = oneDay && range.from === todayKey;
  const copy = COPY[kind];
  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-white px-6 py-12 text-center">
      <h2 className="m-0 font-display text-xl font-extrabold">{copy.title(today, oneDay)}</h2>
      <p className="m-0 max-w-[440px] text-sm text-muted">{copy.description}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {canSeeDate && onLast7Days && (
          <button
            type="button"
            onClick={onLast7Days}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-primary px-4 text-sm font-bold text-white"
          >
            Ver últimos 7 días
          </button>
        )}
        <Link
          to={copy.link}
          className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-bold text-ink hover:bg-bg"
        >
          {copy.linkLabel}
        </Link>
      </div>
    </section>
  );
}

/** A tab the role may open but with every block hidden. */
export function ReportNoBlocks() {
  return (
    <section className="rounded-2xl border border-line bg-white p-8 text-center text-sm text-muted">
      No tenés bloques habilitados en esta pestaña. Pedile al dueño que te habilite alguno desde Configurar vista por rol.
    </section>
  );
}
