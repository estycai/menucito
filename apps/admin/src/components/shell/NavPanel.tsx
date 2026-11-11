import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ProBadge } from "@/components/ProBadge";
import { RestaurantAvatar } from "@/components/RestaurantAvatar";
import { NO_SECTIONS_MESSAGE } from "@/components/NoAccess";
import { activeNavItem, visibleNavItems } from "@/lib/nav";
import { planName } from "@/lib/plans";
import { useMyRestaurant } from "@/lib/restaurant";
import { useSignOut } from "@/lib/session";
import { cn } from "@/lib/utils";

const itemClass =
  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-[10px] px-3 text-left text-[15px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * Panel navigation: wordmark, restaurant card, sections and "Cerrar sesión".
 * Rendered once in the desktop sidebar and once in the mobile drawer.
 */
export function NavPanel({
  onNavigate,
  headerAction,
}: {
  /** Called when a section link is clicked (the drawer closes on it). */
  onNavigate?: () => void;
  /** Extra control next to the wordmark (the drawer's close button). */
  headerAction?: ReactNode;
}) {
  const { pathname } = useLocation();
  // `RequireRestaurant` guarantees the restaurant is loaded.
  const { data: restaurant } = useMyRestaurant();
  const signOut = useSignOut();
  const active = activeNavItem(pathname);
  // Only the sections the member may open (spec 12, scenario 39).
  const items = visibleNavItems(restaurant?.access);

  return (
    <nav aria-label="Panel" className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-[22px] font-extrabold">
          menucito<span className="text-accent">.</span>
        </span>
        {headerAction}
      </div>

      {restaurant && (
        <div className="flex items-center gap-3 rounded-xl bg-addon p-3">
          <RestaurantAvatar name={restaurant.name} logoUrl={restaurant.logoUrl} size="sm" />
          <div className="flex min-w-0 flex-col">
            <b className="truncate text-sm">{restaurant.name}</b>
            <span className="text-xs text-muted">Plan {planName(restaurant.plan)}</span>
          </div>
        </div>
      )}

      <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-1 overflow-y-auto p-0">
        {items.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted">{NO_SECTIONS_MESSAGE}</li>
        )}
        {items.map((item) => {
          const current = item.id === active?.id;
          return (
            <li key={item.id}>
              <Link
                to={item.to}
                aria-current={current ? "page" : undefined}
                onClick={onNavigate}
                className={cn(itemClass, current ? "bg-nav-active font-bold text-link" : "text-ink hover:bg-bg")}
              >
                {item.label}
                {item.isNew && (
                  <span className="rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-primary">
                    NUEVO
                  </span>
                )}
                {item.pro && <ProBadge />}
              </Link>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
        className={cn(itemClass, "text-muted hover:bg-bg disabled:pointer-events-none disabled:opacity-60")}
      >
        Cerrar sesión
      </button>
    </nav>
  );
}
