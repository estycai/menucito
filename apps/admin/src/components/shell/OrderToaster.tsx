import { useSyncExternalStore } from "react";
import { Toaster } from "sonner";
import { NEW_ORDER_TOAST_MS } from "@/lib/new-orders";

/** From this width the toasts go bottom right; below it, top center (spec 11b, scenario 20). */
const TOAST_DESKTOP_QUERY = "(min-width: 640px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(TOAST_DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const isDesktop = () => window.matchMedia(TOAST_DESKTOP_QUERY).matches;

/**
 * The admin's only toast region. Sonner announces each toast through `aria-live` without moving
 * the focus; Alt+T jumps to the toasts and every toast has a close button. Sonner's own styles are
 * not layered, so the admin tokens go in with Tailwind's important modifier.
 */
export function OrderToaster() {
  const desktop = useSyncExternalStore(subscribe, isDesktop);
  return (
    <Toaster
      position={desktop ? "bottom-right" : "top-center"}
      duration={NEW_ORDER_TOAST_MS}
      closeButton
      containerAriaLabel="Avisos"
      toastOptions={{
        closeButtonAriaLabel: "Cerrar aviso",
        classNames: {
          toast: "font-sans! bg-white! text-ink! border-line!",
          description: "text-muted!",
          actionButton: "bg-primary! text-white! font-bold!",
          closeButton: "bg-white! text-ink! border-line!",
        },
      }}
    />
  );
}
