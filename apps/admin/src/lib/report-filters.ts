import {
  FULFILLMENTS,
  ORDER_SOURCES,
  PAYMENT_METHODS,
  REPORT_PRESETS,
  isCalendarDateKey,
  localDateKey,
  presetRange,
  type ReportFilters,
  type ReportPreset,
  type ReportRange,
} from "@menucito/shared";

/** Query names of the Reports URL (Spanish, as the rest of the admin: `?desde=&hasta=&turno=`...). */
export const REPORT_PARAMS = {
  from: "desde",
  to: "hasta",
  shift: "turno",
  fulfillment: "modo",
  payment: "medio",
  source: "origen",
  courier: "repartidor",
  tab: "tab",
} as const;

const text = (search: URLSearchParams, name: string): string | undefined => search.get(name)?.trim() || undefined;

const oneOf = <T extends string>(values: readonly T[], value: string | undefined): T | undefined =>
  value && (values as readonly string[]).includes(value) ? (value as T) : undefined;

/** Reads the filters of the URL, ignoring any value that is not valid. */
export function filtersFromSearch(search: URLSearchParams): ReportFilters {
  const date = (name: string) => {
    const value = text(search, name);
    return value && isCalendarDateKey(value) ? value : undefined;
  };
  return {
    from: date(REPORT_PARAMS.from),
    to: date(REPORT_PARAMS.to),
    shift: text(search, REPORT_PARAMS.shift),
    fulfillment: oneOf(FULFILLMENTS, text(search, REPORT_PARAMS.fulfillment)),
    payment: oneOf(PAYMENT_METHODS, text(search, REPORT_PARAMS.payment)),
    source: oneOf(ORDER_SOURCES, text(search, REPORT_PARAMS.source)),
    courier: text(search, REPORT_PARAMS.courier),
  };
}

/** Writes `filters` over `search`, keeping the tab and dropping the empty values. */
export function searchWithFilters(search: URLSearchParams, filters: ReportFilters): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const [field, param] of Object.entries(REPORT_PARAMS)) {
    if (field === "tab") continue;
    const value = filters[field as keyof ReportFilters];
    if (value) next.set(param, value);
    else next.delete(param);
  }
  return next;
}

export function tabFromSearch(search: URLSearchParams): string | undefined {
  return text(search, REPORT_PARAMS.tab);
}

export function searchWithTab(search: URLSearchParams, tab: string): URLSearchParams {
  const next = new URLSearchParams(search);
  next.set(REPORT_PARAMS.tab, tab);
  return next;
}

/** The preset that exactly matches `range`, or `null` for a custom range. */
export function presetOfRange(range: ReportRange, now: Date): ReportPreset | null {
  for (const preset of REPORT_PRESETS) {
    const candidate = presetRange(preset.id, now);
    if (candidate.from === range.from && candidate.to === range.to) return preset.id;
  }
  return null;
}

/**
 * The filters the page uses: a range-less URL (the first visit to /reportes) means today, so the "Hoy"
 * shortcut shows as active. Without the date filter the range is left out (the API uses today).
 */
export function withDefaultRange(filters: ReportFilters, canSeeDate: boolean, now: Date): ReportFilters {
  if (!canSeeDate) return { ...filters, from: undefined, to: undefined };
  const today = localDateKey(now.getTime());
  return { ...filters, from: filters.from ?? today, to: filters.to ?? today };
}

/** How many filters besides the date are active, for the "Filtros (n)" button. */
export function activeFilterCount(filters: ReportFilters): number {
  return [filters.shift, filters.fulfillment, filters.payment, filters.source, filters.courier].filter(Boolean).length;
}

/** "10/11/2026" for a `YYYY-MM-DD` key. */
export function dateLabel(key: string): string {
  const [year = "", month = "", day = ""] = key.split("-");
  return `${day}/${month}/${year}`;
}
