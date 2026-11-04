import type { StoreHours } from "../lib/store-hours";
import { useMenuHours } from "../lib/use-menu-hours";

interface MenuHoursProps {
  hours: StoreHours;
}

/** "Abierto" / "Cerrado · Abre hoy a las 18:00" next to the restaurant name. The dot only repeats the text. */
export function HoursBadge({ hours }: MenuHoursProps) {
  const status = useMenuHours(hours);
  if (!status) return null;
  return (
    <p class={`hours-badge ${status.open ? "is-open" : "is-closed"}`}>
      <span class="hours-dot" aria-hidden="true" />
      {status.badge}
    </p>
  );
}

/** Under the header while the store is closed and does not take orders outside its hours. */
export function HoursNotice({ hours }: MenuHoursProps) {
  const status = useMenuHours(hours);
  if (!status?.notice) return null;
  return (
    <div class="column">
      <aside class="pause-banner" role="status">
        <p>{status.notice}</p>
      </aside>
    </div>
  );
}
