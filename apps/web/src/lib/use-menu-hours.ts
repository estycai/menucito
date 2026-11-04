import { useEffect, useState } from "preact/hooks";
import { menuHoursStatus, type MenuHoursStatus, type StoreHours } from "./store-hours";

/** How often an open page re-checks the hours, so it follows the store opening and closing. */
const REFRESH_MS = 60_000;

// Shared by every island of the page: the hours islands provide the hours, the ordering controls read them.
let pageHours: StoreHours | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(notify, REFRESH_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/**
 * The menu's hours status for an island, re-checked every minute. Pass `hours` from the islands that
 * render the hours; the others get the status once one of them has hydrated. `null` on the server and
 * the first render (the status depends on the diner's clock), for a store without hours, and while no
 * island provides hours (a paused store renders none, so ordering stays as the pause leaves it).
 */
export function useMenuHours(hours?: StoreHours): MenuHoursStatus | null {
  const [status, setStatus] = useState<MenuHoursStatus | null>(null);

  useEffect(() => {
    const update = () => setStatus(pageHours ? menuHoursStatus(pageHours, new Date()) : null);
    const unsubscribe = subscribe(update);
    if (hours && !pageHours) {
      pageHours = hours;
      notify();
    } else {
      update();
    }
    return unsubscribe;
    // The hours are fixed for the lifetime of a page.
  }, []);

  return status;
}
