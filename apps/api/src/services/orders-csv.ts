import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_LABELS,
  PAYMENT_STATUS_LABELS,
  describeOrderOptions,
  formatLocalDateTime,
  type Fulfillment,
  type OrderDetail,
  type OrderItem,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@menucito/shared";

function escapeCsvCell(val: string | number): string {
  let str = String(val);
  // Formula injection protection: prefix with apostrophe if starts with =, +, -, @, tab or carriage return
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Quote if it contains semicolon, double-quote, or newline
  if (/[;"\r\n]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatMoneyCsv(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function formatItemsSummary(items: OrderItem[]): string {
  return items
    .map((item) => {
      const optionsText = describeOrderOptions(item.options).join(", ");
      return optionsText ? `${item.quantity}x ${item.name} (${optionsText})` : `${item.quantity}x ${item.name}`;
    })
    .join(", ");
}

export function ordersToCsv(orders: OrderDetail[]): string {
  const headers = [
    "Número",
    "Fecha y hora",
    "Estado",
    "Estado de pago",
    "Modalidad",
    "Forma de pago",
    "Efectivo",
    "Transferencia",
    "Abona con",
    "Vuelto",
    "Cliente",
    "Teléfono",
    "Dirección",
    "Repartidor",
    "Subtotal",
    "Envío",
    "Propina",
    "Total",
    "Ítems",
  ];

  const lines: string[] = [headers.map(escapeCsvCell).join(";")];

  for (const order of orders) {
    const row = [
      escapeCsvCell(order.number),
      escapeCsvCell(formatLocalDateTime(order.createdAt)),
      escapeCsvCell(ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status),
      escapeCsvCell(PAYMENT_STATUS_LABELS[order.paymentStatus as PaymentStatus] ?? order.paymentStatus),
      escapeCsvCell(FULFILLMENT_LABELS[order.fulfillment as Fulfillment] ?? order.fulfillment),
      escapeCsvCell(PAYMENT_LABELS[order.paymentMethod as PaymentMethod] ?? order.paymentMethod),
      escapeCsvCell(formatMoneyCsv(order.paymentBreakdown.cashCents)),
      escapeCsvCell(formatMoneyCsv(order.paymentBreakdown.transferCents)),
      escapeCsvCell(order.paymentBreakdown.tenderedCents === null ? "" : formatMoneyCsv(order.paymentBreakdown.tenderedCents)),
      escapeCsvCell(order.paymentBreakdown.changeCents === null ? "" : formatMoneyCsv(order.paymentBreakdown.changeCents)),
      escapeCsvCell(order.customerName),
      escapeCsvCell(order.customerPhone),
      escapeCsvCell(order.deliveryAddress ?? ""),
      escapeCsvCell(order.courier ? `${order.courier.firstName} ${order.courier.lastName}`.trim() : ""),
      escapeCsvCell(formatMoneyCsv(order.subtotalCents)),
      escapeCsvCell(formatMoneyCsv(order.shippingCents)),
      escapeCsvCell(formatMoneyCsv(order.tipCents)),
      escapeCsvCell(formatMoneyCsv(order.totalCents)),
      escapeCsvCell(formatItemsSummary(order.items)),
    ];
    lines.push(row.join(";"));
  }

  // Prepend UTF-8 BOM
  return "\uFEFF" + lines.join("\r\n");
}
