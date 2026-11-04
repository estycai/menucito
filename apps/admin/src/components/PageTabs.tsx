import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router";
import { cn } from "@/lib/utils";

/**
 * Tab header of a page whose tabs are routes: links underlined when active (`NavLink` sets
 * `aria-current="page"`). Scrolls sideways on narrow screens, bleeding into the page gutter, and
 * keeps the active tab in view.
 */
export function PageTabs({ label, tabs }: { label: string; tabs: readonly { to: string; label: string }[] }) {
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav ref={navRef} aria-label={label} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="m-0 flex w-max min-w-full list-none border-b border-line p-0">
        {tabs.map((tab) => (
          <li key={tab.to}>
            <NavLink
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  "-mb-px flex min-h-11 items-center border-b-2 px-4 text-sm font-bold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:px-5",
                  isActive ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink",
                )
              }
            >
              {tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
