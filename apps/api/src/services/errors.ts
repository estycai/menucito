/** Base class for business rule violations; routes translate them to HTTP responses by `code`. */
export abstract class DomainError extends Error {
  abstract readonly code: string;
}

export class RestaurantNotFoundError extends DomainError {
  readonly code = "RESTAURANT_NOT_FOUND";
  constructor() {
    super("You do not have a restaurant yet");
  }
}

/** The restaurant's plan does not include the feature that was used. */
export class PlanFeatureError extends DomainError {
  readonly code = "PLAN_FEATURE";
}

/** Invalid input detected by a service (beyond the route's schema validation). */
export class ValidationError extends DomainError {
  readonly code = "VALIDATION_ERROR";
}

export class StorePausedError extends DomainError {
  readonly code = "STORE_PAUSED";
  constructor(message = "Este local no está recibiendo pedidos por ahora") {
    super(message);
  }
}

export class BelowMinimumError extends DomainError {
  readonly code = "BELOW_MINIMUM";
  constructor(message = "El pedido no alcanza el monto mínimo") {
    super(message);
  }
}

export class PaymentMethodNotAcceptedError extends DomainError {
  readonly code = "PAYMENT_METHOD_NOT_ACCEPTED";
  constructor(message = "El método de pago no está habilitado") {
    super(message);
  }
}

export class FulfillmentNotOfferedError extends DomainError {
  readonly code = "FULFILLMENT_NOT_OFFERED";
  constructor(message = "La modalidad de entrega no está disponible") {
    super(message);
  }
}

export class ProductUnavailableError extends DomainError {
  readonly code = "PRODUCT_UNAVAILABLE";
  constructor(message = "El producto no está disponible") {
    super(message);
  }
}

export class PriceChangedError extends DomainError {
  readonly code = "PRICE_CHANGED";
  constructor(message = "Los precios del pedido cambiaron") {
    super(message);
  }
}

export class InvalidTransitionError extends DomainError {
  readonly code = "INVALID_TRANSITION";
  constructor(message = "Transición de estado no permitida") {
    super(message);
  }
}

export class OrderNotFoundError extends DomainError {
  readonly code = "ORDER_NOT_FOUND";
  constructor(message = "Pedido no encontrado") {
    super(message);
  }
}

export class TooManyOrdersError extends DomainError {
  readonly code = "TOO_MANY_ORDERS";
  constructor(message = "Demasiados pedidos en poco tiempo") {
    super(message);
  }
}

export class ExportTooLargeError extends DomainError {
  readonly code = "EXPORT_TOO_LARGE";
  constructor(message = "Hay demasiados pedidos para exportar. Acotá las fechas.") {
    super(message);
  }
}
