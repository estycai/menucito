import { useEffect, useId, useRef, type ReactNode } from "react";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { cn } from "@/lib/utils";
import { useBackdropClose } from "@/lib/backdrop-close";

interface ModalProps {
  title: string;
  /** Called for every way of closing: the X, Escape and a click on the backdrop. */
  onClose: () => void;
  children: ReactNode;
  /** `md` is a form (550 px); `sm` a short confirmation (440 px). */
  size?: "sm" | "md";
}

/**
 * Modal on a native `<dialog>`: the browser makes the rest of the page inert (focus containment),
 * closes it on Escape and draws the backdrop. Mount it only while it is open; it opens on mount.
 */
export function Modal({ title, onClose, children, size = "md" }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useScrollLock();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const backdropClose = useBackdropClose(onClose);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      {...backdropClose}
      className={cn(
        "fixed inset-0 m-auto h-fit max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl border border-line bg-white p-5 text-ink shadow-2xl backdrop:bg-black/40 open:block sm:p-6",
        size === "sm" ? "max-w-[440px]" : "max-w-[550px]",
      )}
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="m-0 font-display text-xl font-extrabold break-words">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
