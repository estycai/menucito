export const APP_TIME_ZONE = "America/Argentina/Buenos_Aires";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Returns date key in YYYY-MM-DD format for America/Argentina/Buenos_Aires. */
export function localDateKey(ms: number): string {
  return dateFormatter.format(new Date(ms));
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const p: Record<string, string> = {};
  for (const { type, value } of parts) p[type] = value;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - date.getTime();
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `value` is a YYYY-MM-DD key naming a real calendar day (2026-02-31 is not). */
export function isCalendarDateKey(value: string): boolean {
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Returns [startMs, endMs) range in UTC for the given YYYY-MM-DD day in America/Argentina/Buenos_Aires. */
export function localDayRange(dateKey: string): [number, number] {
  const parts = dateKey.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const targetUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = getTimeZoneOffsetMs(new Date(targetUtc), APP_TIME_ZONE);
  const startMs = targetUtc - offset;

  const targetNextUtc = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  const nextOffset = getTimeZoneOffsetMs(new Date(targetNextUtc), APP_TIME_ZONE);
  const endMs = targetNextUtc - nextOffset;

  return [startMs, endMs];
}

const timeFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatLocalTime(ms: number): string {
  return timeFormatter.format(new Date(ms));
}

const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatLocalDateTime(ms: number): string {
  return dateTimeFormatter.format(new Date(ms));
}
