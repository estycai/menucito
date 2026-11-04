import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

/**
 * Opens a native `<dialog>` as modal while the component is mounted: the browser contains focus,
 * closes on Escape and draws the backdrop. The page behind stops scrolling until it unmounts.
 */
export function useModalDialog(dialogRef: RefObject<HTMLDialogElement>): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = previous;
      if (dialog.open) dialog.close();
    };
  }, [dialogRef]);
}
