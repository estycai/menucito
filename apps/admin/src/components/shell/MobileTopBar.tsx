import type { Ref } from "react";
import { RestaurantAvatar } from "@/components/RestaurantAvatar";
import { useMyRestaurant } from "@/lib/restaurant";

export const DRAWER_ID = "nav-drawer";

/** Sticky top bar below `lg`: logo, restaurant name and the button that opens the drawer. */
export function MobileTopBar({
  open,
  onOpen,
  menuButtonRef,
}: {
  open: boolean;
  onOpen: () => void;
  menuButtonRef: Ref<HTMLButtonElement>;
}) {
  // `RequireRestaurant` guarantees the restaurant is loaded.
  const { data: restaurant } = useMyRestaurant();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white px-4 lg:hidden">
      {restaurant && (
        <>
          <RestaurantAvatar name={restaurant.name} logoUrl={restaurant.logoUrl} size="sm" />
          <b className="min-w-0 flex-1 truncate text-[15px]">{restaurant.name}</b>
        </>
      )}
      <button
        ref={menuButtonRef}
        type="button"
        aria-label="Abrir menú"
        aria-expanded={open}
        aria-controls={DRAWER_ID}
        onClick={onOpen}
        className="ml-auto inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-xl hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span aria-hidden="true">☰</span>
      </button>
    </header>
  );
}
