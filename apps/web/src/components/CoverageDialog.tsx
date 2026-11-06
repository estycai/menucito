import { useRef } from "preact/hooks";
import { useModalDialog } from "../lib/use-modal-dialog";
import { useBackdropClose } from "../lib/backdrop-close";

interface CoverageDialogProps {
  /** Whether the store also offers takeaway, so the diner can switch to it. */
  canTakeaway: boolean;
  onTakeaway: () => void;
  onChangeAddress: () => void;
  /** Called for every way of closing, including Escape. Idempotent. */
  onClose: () => void;
}

/** Small modal shown when the diner tries to send an order to an address no zone covers. */
export function CoverageDialog({ canTakeaway, onTakeaway, onChangeAddress, onClose }: CoverageDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog(dialogRef);

  const close = () => {
    dialogRef.current?.close();
    onClose();
  };

  const backdropClose = useBackdropClose(close);
  return (
    <dialog
      ref={dialogRef}
      class="popup"
      aria-labelledby="coverage-title"
      aria-describedby="coverage-text"
      onClose={onClose}
      {...backdropClose}
    >
      <div class="popup-panel">
        <h2 class="popup-title" id="coverage-title">
          Tu dirección está fuera de la zona de entrega
        </h2>
        <p class="popup-text" id="coverage-text">
          {canTakeaway
            ? "El local no hace envíos a esa dirección. Podés retirar tu pedido en el local o elegir otra dirección."
            : "El local no hace envíos a esa dirección. Probá con otra dirección."}
        </p>
        {canTakeaway && (
          <button
            type="button"
            class="primary-button"
            onClick={() => {
              close();
              onTakeaway();
            }}
          >
            Cambiar a retiro
          </button>
        )}
        <button
          type="button"
          class={canTakeaway ? "secondary-button" : "primary-button"}
          onClick={() => {
            close();
            onChangeAddress();
          }}
        >
          Cambiar dirección
        </button>
      </div>
    </dialog>
  );
}
