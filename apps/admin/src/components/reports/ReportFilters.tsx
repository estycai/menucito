import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  FULFILLMENT_LABELS,
  ORDER_SOURCE_LABELS,
  PAYMENT_LABELS,
  REPORT_PRESETS,
  presetRange,
  type Fulfillment,
  type OrderSource,
  type PaymentMethod,
  type ReportFilterKey,
  type ReportFilters,
  type ReportMeta,
} from "@menucito/shared";
import { activeFilterCount, dateLabel, presetOfRange } from "@/lib/report-filters";
import { useBackdropClose } from "@/lib/backdrop-close";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { cn } from "@/lib/utils";

const CONTROL_CLASS =
  "box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

const chip = (active: boolean) =>
  cn(
    "inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-full border px-3.5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
    active ? "border-primary bg-primary text-white" : "border-line bg-white text-ink hover:bg-bg",
  );

interface ReportFiltersProps {
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
  /** Filters the role may use. */
  available: readonly ReportFilterKey[];
  canSeeDate: boolean;
  meta: ReportMeta | undefined;
  /** `true` in the "Configurar vista" preview: the same bar without the URL. */
  compact?: boolean;
}

/** Date shortcuts + filters; on mobile the selects live in a bottom sheet. */
export function ReportFilters({ filters, onChange, available, canSeeDate, meta, compact = false }: ReportFiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const set = <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => onChange({ ...filters, [key]: value });
  const range = { from: filters.from ?? "", to: filters.to ?? "" };
  const preset = range.from && range.to ? presetOfRange({ from: range.from, to: range.to }, new Date()) : null;
  const setPreset = (id: (typeof REPORT_PRESETS)[number]["id"]) => {
    const next = presetRange(id, new Date());
    onChange({ ...filters, from: next.from, to: next.to });
  };
  const clear = () =>
    onChange({
      from: filters.from,
      to: filters.to,
      shift: undefined,
      fulfillment: undefined,
      payment: undefined,
      source: undefined,
      courier: undefined,
    });

  const fields = (
    <FilterFields filters={filters} onChange={onChange} available={available} canSeeDate={canSeeDate} meta={meta} />
  );

  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl border border-line bg-white p-3 sm:p-4", compact && "text-sm")}>
      {canSeeDate ? (
        <>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {REPORT_PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={preset === option.id}
                onClick={() => setPreset(option.id)}
                className={chip(preset === option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <label className="flex items-center gap-2 text-sm text-muted">
              Desde
              <input
                type="date"
                value={range.from}
                max={range.to || undefined}
                onChange={(event) => set("from", event.target.value || undefined)}
                className={CONTROL_CLASS}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              Hasta
              <input
                type="date"
                value={range.to}
                min={range.from || undefined}
                onChange={(event) => set("to", event.target.value || undefined)}
                className={CONTROL_CLASS}
              />
            </label>
            <span className="text-xs text-muted">
              {range.from && range.to ? `${dateLabel(range.from)} – ${dateLabel(range.to)}` : "Personalizado"}
            </span>
          </div>
        </>
      ) : (
        <p className="m-0 text-sm font-bold">Hoy</p>
      )}

      <div className="hidden flex-wrap items-end gap-3 sm:flex">{fields}</div>

      <div className="flex items-center justify-between gap-2 sm:hidden">
        <span className="text-sm text-muted">
          {canSeeDate && range.from && range.to ? `${dateLabel(range.from)} – ${dateLabel(range.to)}` : ""}
        </span>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line px-4 text-sm font-bold"
        >
          Filtros ({activeFilterCount(filters)})
        </button>
      </div>

      {sheetOpen && (
        <BottomSheet title="Filtros" onClose={() => setSheetOpen(false)}>
          <FilterFields
            filters={filters}
            onChange={onChange}
            available={available}
            canSeeDate={canSeeDate}
            meta={meta}
            withDates
          />
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-primary px-5 text-sm font-bold text-white"
            >
              Ver resultados
            </button>
          </div>
        </BottomSheet>
      )}

      {activeFilterCount(filters) > 0 && (
        <button type="button" onClick={clear} className="-ml-1 self-start text-xs font-bold text-link underline-offset-2 hover:underline">
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

function FilterFields({
  filters,
  onChange,
  available,
  canSeeDate,
  meta,
  withDates = false,
}: {
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
  available: readonly ReportFilterKey[];
  canSeeDate: boolean;
  meta: ReportMeta | undefined;
  withDates?: boolean;
}) {
  const has = (key: ReportFilterKey) => available.includes(key);
  const set = <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => onChange({ ...filters, [key]: value });
  const field = (key: ReportFilterKey, label: string, control: ReactNode) =>
    has(key) ? (
      <label key={key} className="flex min-w-[150px] flex-1 flex-col gap-1 text-xs font-bold text-muted">
        {label}
        {control}
      </label>
    ) : null;

  return (
    <>
      {withDates && canSeeDate && (
        <>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Desde
            <input
              type="date"
              value={filters.from ?? ""}
              max={filters.to || undefined}
              onChange={(event) => set("from", event.target.value || undefined)}
              className={CONTROL_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Hasta
            <input
              type="date"
              value={filters.to ?? ""}
              min={filters.from || undefined}
              onChange={(event) => set("to", event.target.value || undefined)}
              className={CONTROL_CLASS}
            />
          </label>
        </>
      )}
      {field(
        "stats.f.shift",
        "Turno",
        <select value={filters.shift ?? ""} onChange={(event) => set("shift", event.target.value || undefined)} className={CONTROL_CLASS}>
          <option value="">Todos</option>
          {(meta?.shifts ?? []).map((shift) => (
            <option key={shift.id} value={shift.id}>
              {shift.label}
            </option>
          ))}
          <option value="off">Fuera de horario</option>
        </select>,
      )}
      {field(
        "stats.f.fulfillment",
        "Modalidad",
        <select
          value={filters.fulfillment ?? ""}
          onChange={(event) => set("fulfillment", (event.target.value || undefined) as Fulfillment | undefined)}
          className={CONTROL_CLASS}
        >
          <option value="">Todas</option>
          <option value="delivery">{FULFILLMENT_LABELS.delivery}</option>
          <option value="takeaway">{FULFILLMENT_LABELS.takeaway}</option>
        </select>,
      )}
      {field(
        "stats.f.payment",
        "Medio de pago",
        <select
          value={filters.payment ?? ""}
          onChange={(event) => set("payment", (event.target.value || undefined) as PaymentMethod | undefined)}
          className={CONTROL_CLASS}
        >
          <option value="">Todos</option>
          <option value="cash">{PAYMENT_LABELS.cash}</option>
          <option value="transfer">{PAYMENT_LABELS.transfer}</option>
          <option value="split">{PAYMENT_LABELS.split}</option>
        </select>,
      )}
      {field(
        "stats.f.source",
        "Origen",
        <select
          value={filters.source ?? ""}
          onChange={(event) => set("source", (event.target.value || undefined) as OrderSource | undefined)}
          className={CONTROL_CLASS}
        >
          <option value="">Todos</option>
          <option value="web">{ORDER_SOURCE_LABELS.web}</option>
          <option value="local">{ORDER_SOURCE_LABELS.local}</option>
          <option value="whatsapp">{ORDER_SOURCE_LABELS.whatsapp}</option>
        </select>,
      )}
      {field(
        "stats.f.courier",
        "Repartidor",
        <select
          value={filters.courier ?? ""}
          onChange={(event) => set("courier", event.target.value || undefined)}
          className={CONTROL_CLASS}
        >
          <option value="">Todos</option>
          {(meta?.couriers ?? []).map((courier) => (
            <option key={courier.memberId} value={courier.memberId}>
              {`${courier.firstName} ${courier.lastName}`.trim()}
            </option>
          ))}
        </select>,
      )}
    </>
  );
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useScrollLock();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const backdropClose = useBackdropClose(onClose);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      {...backdropClose}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border border-line bg-white p-5 text-ink shadow-2xl backdrop:bg-black/40 open:block"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="m-0 font-display text-lg font-extrabold">{title}</h2>
        <button
          type="button"
          aria-label="Cerrar filtros"
          onClick={onClose}
          className="inline-flex size-11 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-ink"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3">{children}</div>
    </dialog>
  );
}
