import type { ReactNode } from "react";
import { Notice } from "@/components/AuthLayout";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  title: string;
  /** What is about to happen and what it costs. */
  children: ReactNode;
  confirmLabel: string;
  /** A destructive action gets the danger color. */
  danger?: boolean;
  pending?: boolean;
  /** Shown inside the dialog when the action failed, so it stays open for another try. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** "Are you sure?" dialog: the message, "Cancelar" and the confirming action. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal title={title} size="sm" onClose={onCancel}>
      <div className="m-0 text-[15px] leading-normal text-ink">{children}</div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel} className="px-5">
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={onConfirm}
          className={danger ? "min-h-12 rounded-xl bg-danger px-5 text-[15px] hover:bg-danger/90" : "min-h-12 rounded-xl px-5 text-[15px]"}
        >
          {pending ? "Un momento…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
