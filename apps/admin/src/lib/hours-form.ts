import {
  HOURS_MESSAGES,
  MAX_SLOTS_PER_DAY,
  WEEKDAYS,
  WEEKDAYS_FROM_MONDAY,
  describeNextOpening,
  hoursStatus,
  minutesToTime,
  replaceHoursSchema,
  timeToMinutes,
  type HoursFulfillment,
  type HoursSlot,
  type ReplaceHoursInput,
  type Weekday,
} from "@menucito/shared";

/**
 * The weekly hours editor of "Horarios": one list of slot drafts per weekday (times as the native
 * time input gives them, "HH:MM") and its mapping to the API input. Pure functions only; the hooks
 * live in `hours.ts`.
 */

export interface SlotDraft {
  /** Stable client key, for React keys and per-slot errors. */
  key: string;
  /** "HH:MM", `""` while the input is empty. */
  opens: string;
  closes: string;
  fulfillment: HoursFulfillment;
}

export type WeekDraft = Readonly<Record<Weekday, readonly SlotDraft[]>>;

export type SlotErrors = Partial<Record<"opens" | "closes", string>>;

/** What a day gets when it is opened: dinner time for both delivery and takeaway. */
export const DEFAULT_SLOT: Omit<SlotDraft, "key"> = { opens: "18:00", closes: "23:00", fulfillment: "all" };

/** Length of a slot added after another one of the same day. */
const NEXT_SLOT_MINUTES = 3 * 60;

export function emptyWeek(): WeekDraft {
  return Object.fromEntries(WEEKDAYS.map((day) => [day, []])) as unknown as WeekDraft;
}

export function weekFromSlots(slots: readonly HoursSlot[], newKey: () => string): WeekDraft {
  const week = Object.fromEntries(WEEKDAYS.map((day) => [day, [] as SlotDraft[]])) as Record<Weekday, SlotDraft[]>;
  for (const slot of slots) {
    week[slot.weekday].push({
      key: newKey(),
      opens: minutesToTime(slot.opensAt),
      closes: minutesToTime(slot.closesAt),
      fulfillment: slot.fulfillment,
    });
  }
  return week;
}

const withDay = (week: WeekDraft, day: Weekday, slots: readonly SlotDraft[]): WeekDraft => ({ ...week, [day]: slots });

/** Ticks or unticks "Cerrado": a closed day has no slots, a reopened one gets `DEFAULT_SLOT`. */
export function setDayClosed(week: WeekDraft, day: Weekday, closed: boolean, newKey: () => string): WeekDraft {
  if (closed) return withDay(week, day, []);
  return week[day].length ? week : withDay(week, day, [{ key: newKey(), ...DEFAULT_SLOT }]);
}

/** Whether the day can take one more slot. */
export const canAddSlot = (week: WeekDraft, day: Weekday) => week[day].length < MAX_SLOTS_PER_DAY;

/** "+ Franja": `DEFAULT_SLOT` on an empty day, else a slot starting where the last one closes. */
export function addSlot(week: WeekDraft, day: Weekday, newKey: () => string): WeekDraft {
  const slots = week[day];
  if (slots.length >= MAX_SLOTS_PER_DAY) return week;
  const lastClose = timeToMinutes(slots.at(-1)?.closes ?? "");
  const slot: SlotDraft =
    lastClose === null
      ? { key: newKey(), ...DEFAULT_SLOT }
      : {
          key: newKey(),
          opens: minutesToTime(lastClose),
          closes: minutesToTime((lastClose + NEXT_SLOT_MINUTES) % (24 * 60)),
          fulfillment: "all",
        };
  return withDay(week, day, [...slots, slot]);
}

export function removeSlot(week: WeekDraft, day: Weekday, key: string): WeekDraft {
  return withDay(
    week,
    day,
    week[day].filter((slot) => slot.key !== key),
  );
}

export function updateSlot(week: WeekDraft, day: Weekday, key: string, patch: Partial<Omit<SlotDraft, "key">>): WeekDraft {
  return withDay(
    week,
    day,
    week[day].map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)),
  );
}

/** "Copiar a otros días": `targets` get copies of the slots of `from` (a closed day closes them). */
export function copyDay(week: WeekDraft, from: Weekday, targets: readonly Weekday[], newKey: () => string): WeekDraft {
  const next: Record<Weekday, readonly SlotDraft[]> = { ...week };
  for (const day of targets) {
    if (day !== from) next[day] = week[from].map((slot) => ({ ...slot, key: newKey() }));
  }
  return next;
}

/** Comparable snapshot of the week without the client keys, to tell whether there are unsaved changes. */
export function weekSignature(week: WeekDraft): string {
  return JSON.stringify(WEEKDAYS.map((day) => week[day].map(({ opens, closes, fulfillment }) => [opens, closes, fulfillment])));
}

export interface WeekCheck {
  /** The body of `PUT /api/restaurants/me/hours`, or `null` while some slot is invalid. */
  input: ReplaceHoursInput | null;
  /** Errors by slot key. */
  errors: Record<string, SlotErrors>;
}

/** Validates the week with the shared schema (Monday first) and maps its issues back to the slots. */
export function checkWeek(week: WeekDraft): WeekCheck {
  const keys: string[] = [];
  const errors: Record<string, SlotErrors> = {};
  const addError = (key: string, field: keyof SlotErrors, message: string) => {
    errors[key] = { ...errors[key], [field]: errors[key]?.[field] ?? message };
  };

  const slots = WEEKDAYS_FROM_MONDAY.flatMap((weekday) =>
    week[weekday].map((slot) => {
      keys.push(slot.key);
      const opensAt = timeToMinutes(slot.opens);
      const closesAt = timeToMinutes(slot.closes);
      if (opensAt === null) addError(slot.key, "opens", HOURS_MESSAGES.timeInvalid);
      if (closesAt === null) addError(slot.key, "closes", HOURS_MESSAGES.timeInvalid);
      return { weekday, opensAt: opensAt ?? 0, closesAt: closesAt ?? 0, fulfillment: slot.fulfillment };
    }),
  );
  if (Object.keys(errors).length) return { input: null, errors };

  const parsed = replaceHoursSchema.safeParse({ slots });
  if (parsed.success) return { input: parsed.data, errors };

  for (const issue of parsed.error.issues) {
    const [, index, field] = issue.path;
    const key = typeof index === "number" ? keys[index] : undefined;
    if (key) addError(key, field === "closesAt" ? "closes" : "opens", issue.message);
  }
  return { input: null, errors };
}

/** The status line above the editor, from the saved hours. */
export interface HoursBanner {
  tone: "success" | "info" | "warning";
  text: string;
  /** Point the owner to "General" to resume order reception. */
  pausedLink: boolean;
}

export function hoursBanner(slots: readonly HoursSlot[], acceptingOrders: boolean, date: Date): HoursBanner {
  if (!acceptingOrders) {
    return {
      tone: "warning",
      text: "La recepción de pedidos está pausada: tus clientes no pueden pedir aunque estés en horario.",
      pausedLink: true,
    };
  }
  if (slots.length === 0) {
    return { tone: "info", text: "Todavía no cargaste horarios: tu local figura siempre abierto.", pausedLink: false };
  }
  const status = hoursStatus({ slots, acceptOrdersOutsideHours: false }, date);
  if (status.open) return { tone: "success", text: "Según tus horarios, ahora estás abierto.", pausedLink: false };
  const when = status.next ? ` Abre ${describeNextOpening(status.next)}.` : "";
  return { tone: "info", text: `Según tus horarios, ahora estás cerrado.${when}`, pausedLink: false };
}
