/** Elapsed time of an order, as the Individual view shows it: "ahora", "5 min", "1 h", "2 h 10 min". */
export function formatElapsed(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;

  const days = Math.floor(hours / 24);
  return days === 1 ? "1 día" : `${days} días`;
}
