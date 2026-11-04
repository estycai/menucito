import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  HOURS_FULFILLMENTS,
  HOURS_FULFILLMENT_TEXT,
  WEEKDAYS_FROM_MONDAY,
  WEEKDAY_NAMES,
  timeToMinutes,
  type HoursSlot,
  type Weekday,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { QueryError } from "@/components/QueryError";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { useStoreHours, useSaveStoreHours } from "@/lib/hours";
import {
  addSlot,
  canAddSlot,
  checkWeek,
  copyDay,
  hoursBanner,
  removeSlot,
  setDayClosed,
  updateSlot,
  weekFromSlots,
  weekSignature,
  type SlotDraft,
  type SlotErrors,
  type WeekDraft,
} from "@/lib/hours-form";
import { useStoreSettings } from "@/lib/settings";

const HOURS_MESSAGES = {
  loadFailed: "No pudimos cargar los horarios.",
  saved: "Horarios guardados",
  invalid: "Revisá las franjas marcadas en rojo.",
  saveFailed: "No pudimos guardar los horarios. Probá de nuevo.",
} as const;

const CONTROL_CLASS =
  "box-border h-11 w-full min-w-0 rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-danger";

const dayLabel = (day: Weekday) => WEEKDAY_NAMES[day].charAt(0).toUpperCase() + WEEKDAY_NAMES[day].slice(1);

let keySeed = 0;
const newKey = () => `slot-${keySeed++}`;

type SaveStatus = { tone: "success" | "error"; text: string } | null;

/** "Horarios": loads the hours and the settings (for the paused state), then renders the editor. */
export function HoursTab() {
  const hours = useStoreHours();
  const settings = useStoreSettings();

  if (!hours.data || !settings.data) {
    const failed = hours.isError || settings.isError;
    return failed ? (
      <QueryError
        message={HOURS_MESSAGES.loadFailed}
        onRetry={() => {
          void hours.refetch();
          void settings.refetch();
        }}
        retrying={hours.isRefetching || settings.isRefetching}
      />
    ) : null;
  }

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <HoursBannerNotice slots={hours.data.slots} acceptingOrders={settings.data.acceptingOrders} />
      <HoursEditor savedSlots={hours.data.slots} />
    </div>
  );
}

/** Whether the saved hours say the store is open right now; refreshed every half minute. */
function HoursBannerNotice({ slots, acceptingOrders }: { slots: HoursSlot[]; acceptingOrders: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const banner = hoursBanner(slots, acceptingOrders, now);
  return (
    <Notice tone={banner.tone}>
      {banner.text}
      {banner.pausedLink && (
        <>
          {" "}
          <Link to="/local/general" className="font-bold text-inherit underline">
            Activala en General
          </Link>
          .
        </>
      )}
    </Notice>
  );
}

/** "Horarios de atención": one row per day, Monday first, saved as a whole week. */
function HoursEditor({ savedSlots }: { savedSlots: HoursSlot[] }) {
  const save = useSaveStoreHours();
  const [week, setWeek] = useState<WeekDraft>(() => weekFromSlots(savedSlots, newKey));
  const [baseline, setBaseline] = useState(() => weekSignature(weekFromSlots(savedSlots, newKey)));
  const [status, setStatus] = useState<SaveStatus>(null);

  const dirty = weekSignature(week) !== baseline;
  // Checked on every edit so an overlap or a bad time shows up while typing, not only on save.
  const check = useMemo(() => checkWeek(week), [week]);
  const errors: Record<string, SlotErrors> = check.input ? {} : check.errors;

  function edit(next: (current: WeekDraft) => WeekDraft) {
    setStatus(null);
    setWeek(next);
  }

  async function handleSave() {
    if (!check.input) {
      setStatus({ tone: "error", text: HOURS_MESSAGES.invalid });
      return;
    }
    setStatus(null);
    try {
      const saved = await save.mutateAsync(check.input);
      const stored = weekFromSlots(saved.slots, newKey);
      setWeek(stored);
      setBaseline(weekSignature(stored));
      setStatus({ tone: "success", text: HOURS_MESSAGES.saved });
    } catch {
      setStatus({ tone: "error", text: HOURS_MESSAGES.saveFailed });
    }
  }

  return (
    <SectionCard
      title="Horarios de atención"
      description="¿Cerrás después de medianoche? Cargá una sola franja: 19:00 a 01:00."
    >
      <ul aria-label="Días de la semana" className="m-0 flex list-none flex-col p-0">
        {WEEKDAYS_FROM_MONDAY.map((day) => (
          <DayRow
            key={day}
            day={day}
            slots={week[day]}
            errors={errors}
            canAdd={canAddSlot(week, day)}
            onClosedChange={(closed) => edit((current) => setDayClosed(current, day, closed, newKey))}
            onAdd={() => edit((current) => addSlot(current, day, newKey))}
            onChange={(key, patch) => edit((current) => updateSlot(current, day, key, patch))}
            onRemove={(key) => edit((current) => removeSlot(current, day, key))}
            onCopy={(targets) => edit((current) => copyDay(current, day, targets, newKey))}
          />
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="min-w-0" aria-live="polite">
          {status?.tone === "success" && <Notice tone="success">{status.text}</Notice>}
        </div>
        <Button
          type="button"
          className="min-h-12 rounded-xl px-[26px] text-[15px]"
          disabled={!dirty || save.isPending}
          onClick={() => void handleSave()}
        >
          Guardar cambios
        </Button>
      </div>
      {status?.tone === "error" && <Notice tone="error">{status.text}</Notice>}
    </SectionCard>
  );
}

function DayRow({
  day,
  slots,
  errors,
  canAdd,
  onClosedChange,
  onAdd,
  onChange,
  onRemove,
  onCopy,
}: {
  day: Weekday;
  slots: readonly SlotDraft[];
  errors: Record<string, SlotErrors>;
  canAdd: boolean;
  onClosedChange: (closed: boolean) => void;
  onAdd: () => void;
  onChange: (key: string, patch: Partial<Omit<SlotDraft, "key">>) => void;
  onRemove: (key: string) => void;
  onCopy: (targets: Weekday[]) => void;
}) {
  const name = dayLabel(day);
  const closed = slots.length === 0;

  return (
    <li className="flex flex-col gap-3 border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0 md:flex-row md:gap-5">
      <div className="flex items-center justify-between gap-3 md:w-[130px] md:shrink-0 md:flex-col md:items-start md:gap-1">
        <h3 className="m-0 text-[15px] font-bold">{name}</h3>
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 md:min-h-9">
          <input
            type="checkbox"
            checked={closed}
            onChange={(e) => onClosedChange(e.target.checked)}
            aria-label={`${name} cerrado`}
            className="size-5 cursor-pointer rounded border-line accent-primary"
          />
          <span className="text-sm text-muted">Cerrado</span>
        </label>
      </div>

      {!closed && (
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {slots.map((slot, index) => (
            <SlotRow
              key={slot.key}
              label={`${name}, franja ${index + 1}`}
              slot={slot}
              errors={errors[slot.key]}
              onChange={(patch) => onChange(slot.key, patch)}
              onRemove={() => onRemove(slot.key)}
            />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" className="min-h-11 px-3 text-sm" onClick={onAdd} disabled={!canAdd}>
              + Franja
            </Button>
            <CopyDayMenu from={day} onCopy={onCopy} />
          </div>
        </div>
      )}
      {closed && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <CopyDayMenu from={day} onCopy={onCopy} />
        </div>
      )}
    </li>
  );
}

function SlotRow({
  label,
  slot,
  errors,
  onChange,
  onRemove,
}: {
  label: string;
  slot: SlotDraft;
  errors: SlotErrors | undefined;
  onChange: (patch: Partial<Omit<SlotDraft, "key">>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const opensAt = timeToMinutes(slot.opens);
  const closesAt = timeToMinutes(slot.closes);
  const crossesMidnight = opensAt !== null && closesAt !== null && closesAt < opensAt;
  const errorText = [errors?.opens, errors?.closes].filter(Boolean).join(". ");

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-3">
        <TimeField id={`${id}-opens`} label="Apertura" value={slot.opens} invalid={Boolean(errors?.opens)} onChange={(opens) => onChange({ opens })} />
        <TimeField id={`${id}-closes`} label="Cierre" value={slot.closes} invalid={Boolean(errors?.closes)} onChange={(closes) => onChange({ closes })} />
        <div className="flex min-w-[170px] flex-1 flex-col gap-1">
          <label htmlFor={`${id}-fulfillment`} className="text-xs font-semibold text-muted">
            Disponible en
          </label>
          <select
            id={`${id}-fulfillment`}
            value={slot.fulfillment}
            onChange={(e) => onChange({ fulfillment: e.target.value as SlotDraft["fulfillment"] })}
            className={CONTROL_CLASS}
          >
            {HOURS_FULFILLMENTS.map((option) => (
              <option key={option} value={option}>
                {HOURS_FULFILLMENT_TEXT[option]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          aria-label={`Borrar ${label}`}
          title="Borrar"
          onClick={onRemove}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-ink hover:bg-tab focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16M10 11v6M14 11v6" />
            <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
          </svg>
        </button>
      </div>
      {errorText ? (
        <p className="m-0 text-[13px] text-danger">{errorText}</p>
      ) : (
        crossesMidnight && <p className="m-0 text-xs text-muted">Cierra al día siguiente.</p>
      )}
    </div>
  );
}

function TimeField({
  id,
  label,
  value,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex w-[124px] flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </label>
      <input
        id={id}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid ? true : undefined}
        className={CONTROL_CLASS}
      />
    </div>
  );
}

/** "Copiar a otros días": a small menu to pick the days that get this day's slots. */
function CopyDayMenu({ from, onCopy }: { from: Weekday; onCopy: (targets: Weekday[]) => void }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<ReadonlySet<Weekday>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const others = WEEKDAYS_FROM_MONDAY.filter((day) => day !== from);
  // `Button` takes no ref; its element is the first button of the menu.
  const focusToggle = () => rootRef.current?.querySelector("button")?.focus();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        focusToggle();
      } else if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function toggle(day: Weekday, checked: boolean) {
    setTargets((prev) => {
      const next = new Set(prev);
      if (checked) next.add(day);
      else next.delete(day);
      return next;
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        className="min-h-11 px-3 text-sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setTargets(new Set());
          setOpen((value) => !value);
        }}
      >
        Copiar a otros días
      </Button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={`Copiar los horarios del ${WEEKDAY_NAMES[from]}`}
          className="absolute top-full left-0 z-20 mt-1 flex w-[240px] flex-col gap-1 rounded-xl border border-line bg-white p-3 shadow-lg"
        >
          <p className="m-0 pb-1 text-xs font-semibold text-muted">Copiar a</p>
          {others.map((day) => (
            <label key={day} className="flex min-h-10 cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={targets.has(day)}
                onChange={(e) => toggle(day, e.target.checked)}
                className="size-5 cursor-pointer rounded border-line accent-primary"
              />
              <span className="text-sm">{dayLabel(day)}</span>
            </label>
          ))}
          <button
            type="button"
            className="cursor-pointer self-start rounded-lg px-1 py-1 text-xs font-semibold text-primary hover:underline"
            onClick={() => setTargets(new Set(targets.size === others.length ? [] : others))}
          >
            {targets.size === others.length ? "Ninguno" : "Todos"}
          </button>
          <Button
            type="button"
            className="mt-1 min-h-11 rounded-xl text-sm"
            disabled={targets.size === 0}
            onClick={() => {
              onCopy([...targets]);
              setOpen(false);
              focusToggle();
            }}
          >
            Copiar
          </Button>
        </div>
      )}
    </div>
  );
}
