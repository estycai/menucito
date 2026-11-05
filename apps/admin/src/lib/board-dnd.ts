import type { PointerEvent as ReactPointerEvent } from "react";
import {
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type Announcements,
  type CollisionDetection,
  type KeyboardCodes,
  type KeyboardCoordinateGetter,
  type PointerSensorOptions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { ORDER_STATUS_LABELS, type OrderSummary } from "@menucito/shared";
import { adjacentColumn, isValidDrop, type BoardDropStatus, type BoardPermissions } from "./orders";

export interface BoardColumnConfig {
  status: BoardDropStatus;
  /** Plural title ("Listos"), unlike the status labels of `ORDER_STATUS_LABELS` ("Listo"). */
  label: string;
  /**
   * A final status: the column lists the orders delivered today (its own query), its cards open
   * the detail but cannot be dragged, and it links to the history. It still accepts drops.
   */
  isFinal?: boolean;
  emptyMessage: string;
}

/** Columns of the board, in reading order. */
export const BOARD_COLUMNS: BoardColumnConfig[] = [
  { status: "new", label: "Nuevos", emptyMessage: "Sin pedidos" },
  { status: "preparing", label: "En preparación", emptyMessage: "Sin pedidos" },
  { status: "ready", label: "Listos", emptyMessage: "Sin pedidos" },
  { status: "sent", label: "Enviados", emptyMessage: "Sin pedidos" },
  { status: "delivered", label: "Entregados", emptyMessage: "Sin pedidos entregados hoy", isFinal: true },
];

// Long enough to cover the keyup "click" that follows a keyboard drop, short enough to go unnoticed.
export const KEYBOARD_DROP_CLICK_GUARD_MS = 400;

/**
 * Whether a click on a card at `now` must be ignored: while a keyboard drag is in progress and for a
 * short moment after it ends (`ignoreUntil`). A time window, not "until keyup", can never get stuck
 * if the keyup is lost.
 */
export function isClickGuarded(keyboardDragging: boolean, ignoreUntil: number, now: number): boolean {
  return keyboardDragging || now < ignoreUntil;
}

// Space picks a card up and drops it; Enter keeps opening the detail (and also drops while dragging).
export const BOARD_KEYBOARD_CODES: KeyboardCodes = {
  start: ["Space"],
  cancel: ["Escape"],
  end: ["Space", "Enter"],
};

export const BOARD_SCREEN_READER_INSTRUCTIONS = {
  draggable:
    "Para mover el pedido, presioná Espacio. Con las flechas elegís la columna, con Espacio lo soltás y con Escape cancelás. Con Enter abrís el detalle.",
};

/** Screen reader announcements of a drag over the board columns. */
export function boardAnnouncements(
  findOrder: (id: UniqueIdentifier) => OrderSummary | undefined,
  permissions: BoardPermissions = {},
): Announcements {
  const numberOf = (id: UniqueIdentifier) => `#${findOrder(id)?.number ?? ""}`;
  return {
    onDragStart: ({ active }) => `Tomaste el pedido ${numberOf(active.id)}.`,
    onDragOver: ({ active, over }) => {
      if (!over) return `Pedido ${numberOf(active.id)} fuera de las columnas.`;
      const order = findOrder(active.id);
      const label = ORDER_STATUS_LABELS[over.id as BoardDropStatus];
      return order && isValidDrop(order.status, order.fulfillment, over.id, permissions)
        ? `Pedido ${numberOf(active.id)} sobre ${label}.`
        : `Pedido ${numberOf(active.id)} sobre ${label}. No se puede mover ahí.`;
    },
    onDragEnd: ({ active, over }) => {
      const order = findOrder(active.id);
      return order && over && isValidDrop(order.status, order.fulfillment, over.id, permissions)
        ? `Soltaste el pedido ${numberOf(active.id)} en ${ORDER_STATUS_LABELS[over.id]}.`
        : `Soltaste el pedido ${numberOf(active.id)}. No cambió de estado.`;
    },
    onDragCancel: () => "Cancelaste el arrastre.",
  };
}

/** Mouse and pen only: touch goes through the TouchSensor and its press delay, so scrolling still works. */
export class MousePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: ReactPointerEvent, { onActivation }: PointerSensorOptions) => {
        if (!event.isPrimary || event.button !== 0 || event.pointerType === "touch") return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

/** Pointer position first (it works with the stacked columns on phones), card overlap for keyboard drags. */
export const boardCollisionDetection: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  return byPointer.length > 0 ? byPointer : rectIntersection(args);
};

const ARROW_STEPS: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Column step of an arrow key (`1` forward, `-1` backward), or `undefined` for any other key. */
export function arrowStep(code: string): 1 | -1 | undefined {
  return ARROW_STEPS[code];
}

/** Arrow keys jump the dragged card to the previous or next column instead of moving it by pixels. */
export const columnKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const step = arrowStep(event.code);
  if (!step) return undefined;
  event.preventDefault();

  const { active, over, droppableRects, collisionRect } = context;
  const target = adjacentColumn(over?.id ?? active?.data.current?.status, step);
  const rect = target ? droppableRects.get(target) : undefined;
  if (!rect || !collisionRect) return undefined;
  return {
    x: rect.left + Math.max(0, (rect.width - collisionRect.width) / 2),
    y: rect.top + Math.max(0, Math.min(56, (rect.height - collisionRect.height) / 2)),
  };
};
