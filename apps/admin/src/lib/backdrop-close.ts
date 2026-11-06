import { useRef, type MouseEvent, type PointerEvent } from "react";

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Whether a point falls outside the dialog box, i.e. on the backdrop drawn around it. */
export function isOutsideBox(box: Box, x: number, y: number): boolean {
  return x < box.left || x > box.right || y < box.top || y > box.bottom;
}

/**
 * Handlers that close a modal `<dialog>` on a backdrop click. The press must start AND end on the
 * backdrop: selecting text inside the dialog and releasing the mouse outside fires a `click` on the
 * dialog too, and that must not close it. The box check also keeps clicks on the dialog padding open.
 */
export function useBackdropClose(onClose: () => void) {
  const pressedOutside = useRef(false);
  const outside = (event: { currentTarget: HTMLDialogElement; clientX: number; clientY: number }) =>
    isOutsideBox(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => {
      pressedOutside.current = event.target === event.currentTarget && outside(event);
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      const startedOutside = pressedOutside.current;
      pressedOutside.current = false;
      if (startedOutside && event.target === event.currentTarget && outside(event)) onClose();
    },
  };
}
