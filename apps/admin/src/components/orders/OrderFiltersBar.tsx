import { useId, type ReactNode } from "react";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@menucito/shared";
import type { DatePreset, OrderFilters } from "@/lib/orders";

const CONTROL_CLASS =
  "box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

const DATE_PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: "", label: "Todas las fechas" },
  { id: "today", label: "Hoy" },
  { id: "7d", label: "Últimos 7 días" },
  { id: "30d", label: "Últimos 30 días" },
  { id: "custom", label: "Personalizado" },
];

type FilterUpdater = (updater: (prev: OrderFilters) => OrderFilters) => void;

/** Filters of the history; they live in the URL search params (the page owns them). */
export function OrderFiltersBar({ filters, onFilterChange }: { filters: OrderFilters; onFilterChange: FilterUpdater }) {
  const set = (key: Exclude<keyof OrderFilters, "preset">) => (value: string) =>
    onFilterChange((prev) => ({ ...prev, [key]: value || undefined }));

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FilterField label="Fecha">
          {(id) => (
            <select
              id={id}
              value={filters.preset ?? ""}
              onChange={(e) => {
                const val = e.target.value as DatePreset;
                onFilterChange((prev) => ({
                  ...prev,
                  preset: val,
                  from: val === "custom" ? prev.from : undefined,
                  to: val === "custom" ? prev.to : undefined,
                }));
              }}
              className={CONTROL_CLASS}
            >
              {DATE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </FilterField>

        <FilterField label="Estado">
          {(id) => (
            <select id={id} value={filters.status ?? ""} onChange={(e) => set("status")(e.target.value)} className={CONTROL_CLASS}>
              <option value="">Todos los estados</option>
              {/* Single statuses only; the "active" group is the board's, not a history filter. */}
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ORDER_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          )}
        </FilterField>

        <FilterField label="Modalidad">
          {(id) => (
            <select
              id={id}
              value={filters.fulfillment ?? ""}
              onChange={(e) => set("fulfillment")(e.target.value)}
              className={CONTROL_CLASS}
            >
              <option value="">Todas</option>
              <option value="delivery">Envío</option>
              <option value="takeaway">Retiro</option>
            </select>
          )}
        </FilterField>

        <FilterField label="Forma de pago">
          {(id) => (
            <select
              id={id}
              value={filters.paymentMethod ?? ""}
              onChange={(e) => set("paymentMethod")(e.target.value)}
              className={CONTROL_CLASS}
            >
              <option value="">Todas</option>
              <option value="cash">Efectivo</option>
              <option value="transfer">Transferencia</option>
              <option value="split">Dividir pago</option>
            </select>
          )}
        </FilterField>

        <FilterField label="Estado de pago">
          {(id) => (
            <select
              id={id}
              value={filters.paymentStatus ?? ""}
              onChange={(e) => set("paymentStatus")(e.target.value)}
              className={CONTROL_CLASS}
            >
              <option value="">Todos</option>
              <option value="pending">Pendiente</option>
              <option value="paid">Pagado</option>
            </select>
          )}
        </FilterField>
      </div>

      {filters.preset === "custom" && (
        <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
          <FilterField label="Desde">
            {(id) => (
              <input id={id} type="date" value={filters.from ?? ""} onChange={(e) => set("from")(e.target.value)} className={CONTROL_CLASS} />
            )}
          </FilterField>
          <FilterField label="Hasta">
            {(id) => (
              <input id={id} type="date" value={filters.to ?? ""} onChange={(e) => set("to")(e.target.value)} className={CONTROL_CLASS} />
            )}
          </FilterField>
        </div>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-bold text-muted">
        {label}
      </label>
      {children(id)}
    </div>
  );
}
