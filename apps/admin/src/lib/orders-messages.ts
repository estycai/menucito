/** UI copy of the orders screen (board, history, export and detail). */
export const ORDERS_UI_MESSAGES = {
  listLoadFailed: "No pudimos cargar los pedidos.",
  listRefreshFailed: "No pudimos actualizar los pedidos. Mostramos los últimos que cargamos.",
  detailLoadFailed: "No pudimos cargar el pedido.",
  orderChanged: "El pedido cambió. Lo actualizamos.",
  updateFailed: "No pudimos actualizar el pedido. Probá de nuevo.",
  exportTooLarge: "Hay demasiados pedidos para exportar. Acotá las fechas.",
  exportFailed: "No pudimos exportar los pedidos. Probá de nuevo.",
} as const;
