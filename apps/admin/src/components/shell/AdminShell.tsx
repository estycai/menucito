import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { activeNavItem, documentTitle } from "@/lib/nav";
import { MobileTopBar } from "./MobileTopBar";
import { NavDrawer } from "./NavDrawer";
import { NavPanel } from "./NavPanel";

/**
 * Layout route of every admin page with a restaurant: sidebar from `lg`, top bar + drawer below it.
 * Owns the only `<main>` of those pages.
 */
export function AdminShell() {
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const section = activeNavItem(pathname)?.title;
  // A layout effect runs before the pages' own `useDocumentTitle` effects, so a page can override this.
  // It depends on `pathname` so leaving a page with its own title restores the section title.
  useLayoutEffect(() => {
    if (section) document.title = documentTitle(section);
  }, [section, pathname]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  return (
    <div className="min-h-screen bg-bg text-ink lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-xl focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-bold focus:text-link focus:shadow-lg"
      >
        Saltar al contenido
      </a>
      <aside className="hidden h-screen w-60 shrink-0 border-r border-line bg-white lg:sticky lg:top-0 lg:block">
        <NavPanel />
      </aside>
      <div className="min-w-0 flex-1">
        <MobileTopBar open={drawerOpen} onOpen={() => setDrawerOpen(true)} menuButtonRef={menuButtonRef} />
        <NavDrawer open={drawerOpen} onClose={closeDrawer} />
        <main id="main" tabIndex={-1} className="px-4 py-6 outline-none sm:px-8 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
