import { useEffect, useRef } from "react";
import { NavPanel } from "./NavPanel";
import { DRAWER_ID } from "./MobileTopBar";

const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * Mobile navigation drawer on a native modal `<dialog>`: the browser makes the rest of the page inert
 * (focus containment), closes it on Escape and draws the backdrop. `open` is the source of truth;
 * `onClose` is called for every way of closing, including the ones the browser handles itself.
 */
export function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = previous;
    };
  }, [open]);

  // The sidebar takes over from `lg`, so the drawer must not stay open behind it.
  useEffect(() => {
    if (!open) return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) onClose();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [open, onClose]);

  return (
    <dialog
      ref={dialogRef}
      id={DRAWER_ID}
      aria-label="Menú de navegación"
      // Escape fires `close`, which keeps the React state in sync.
      onClose={onClose}
      // A click on the backdrop targets the dialog itself; the panel fills the rest of it.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[280px] max-w-[85vw] overflow-hidden border-0 bg-white p-0 text-ink shadow-xl backdrop:bg-black/40 open:block motion-safe:open:animate-[drawer-in_.2s_ease-out]"
    >
      {/* Mounted only while open, so the page never has two live copies of the navigation. */}
      {open && (
        <NavPanel
          onNavigate={onClose}
          headerAction={
            <button
              type="button"
              aria-label="Cerrar menú"
              onClick={onClose}
              className="inline-flex size-11 cursor-pointer items-center justify-center rounded-[10px] text-xl hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span aria-hidden="true">✕</span>
            </button>
          }
        />
      )}
    </dialog>
  );
}
