/** Base class for business rule violations; routes translate them to HTTP responses by `code`. */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  /** Extra fields for the error body (e.g. how many members block a role deletion). */
  readonly details?: Readonly<Record<string, unknown>>;
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

/** The store is outside its opening hours and does not take orders while closed. */
export class StoreClosedError extends DomainError {
  readonly code = "STORE_CLOSED";
  constructor(message = "El local está cerrado ahora") {
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

/** An order cannot pass to `sent` without a courier; the board must assign one first. */
export class CourierRequiredError extends DomainError {
  readonly code = "COURIER_REQUIRED";
  constructor(message = "Asigná un repartidor antes de pasar el pedido a Enviado") {
    super(message);
  }
}

/** The order changed between the read and the write (a simultaneous assignment or status change). */
export class ConcurrentModificationError extends DomainError {
  readonly code = "CONCURRENT_MODIFICATION";
  constructor(message = "Otro cambio simultáneo ganó. Recargá el pedido y probá de nuevo.") {
    super(message);
  }
}

/** The member has orders assigned and cannot be deleted without losing their history. */
export class MemberHasHistoryError extends DomainError {
  readonly code = "MEMBER_HAS_HISTORY";
  constructor(message = "Este usuario tiene pedidos asignados. Desactivalo en lugar de eliminarlo.") {
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

/** The order number kept colliding with concurrent orders; the diner can safely send it again. */
export class OrderNumberConflictError extends DomainError {
  readonly code = "ORDER_NUMBER_CONFLICT";
  constructor(message = "No pudimos registrar tu pedido. Probá de nuevo en unos segundos.") {
    super(message);
  }
}

/** The address search is not available (no Google key, quota, outage); the owner can retry later. */
export class MapsUnavailableError extends DomainError {
  readonly code = "MAPS_UNAVAILABLE";
  constructor(message = "La búsqueda de direcciones no está disponible. Probá de nuevo en unos minutos.") {
    super(message);
  }
}

export class PlaceNotFoundError extends DomainError {
  readonly code = "PLACE_NOT_FOUND";
  constructor(message = "No encontramos esa dirección") {
    super(message);
  }
}

/** The delivery address is outside every active zone of the store. */
export class OutOfCoverageError extends DomainError {
  readonly code = "OUT_OF_COVERAGE";
  constructor(message = "Tu dirección está fuera de la zona de entrega") {
    super(message);
  }
}

/** The store does not deliver by zones, so the address search and the quote are not available. */
export class DeliveryZonesDisabledError extends DomainError {
  readonly code = "DELIVERY_ZONES_DISABLED";
  constructor(message = "Este local no usa zonas de entrega") {
    super(message);
  }
}

/** The store now delivers by zones and the order came with a typed address only (an outdated page). */
export class DeliveryLocationRequiredError extends DomainError {
  readonly code = "DELIVERY_LOCATION_REQUIRED";
  constructor(message = "Elegí tu dirección en el mapa para que el local calcule el envío") {
    super(message);
  }
}

/** Too many requests from the same address (IP) in a short time. */
export class RateLimitedError extends DomainError {
  readonly code = "RATE_LIMITED";
  constructor(message = "Hiciste muchas búsquedas seguidas. Probá de nuevo en unos minutos.") {
    super(message);
  }
}

export class MemberNotFoundError extends DomainError {
  readonly code = "MEMBER_NOT_FOUND";
  constructor(message = "Usuario no encontrado") {
    super(message);
  }
}

export class RoleNotFoundError extends DomainError {
  readonly code = "ROLE_NOT_FOUND";
  constructor(message = "Rol no encontrado") {
    super(message);
  }
}

/** The email already has an account (of another local, an owner, or someone who signed up alone). */
export class EmailInUseError extends DomainError {
  readonly code = "EMAIL_IN_USE";
  constructor(message = "Ya hay una cuenta con ese email.") {
    super(message);
  }
}

/** The owner's member cannot change role, be deactivated, get a new password or be deleted. */
export class OwnerImmutableError extends DomainError {
  readonly code = "OWNER_IMMUTABLE";
  constructor(message = "No se puede hacer esto con el dueño del local") {
    super(message);
  }
}

/** The system role ("Dueño") cannot be edited, deactivated or deleted. */
export class SystemRoleError extends DomainError {
  readonly code = "SYSTEM_ROLE";
  constructor(message = "El rol Dueño es del sistema y no se puede modificar") {
    super(message);
  }
}

export class RoleInUseError extends DomainError {
  readonly code = "ROLE_IN_USE";
  readonly details: { memberCount: number };
  constructor(memberCount: number) {
    super(`El rol tiene ${memberCount} ${memberCount === 1 ? "usuario" : "usuarios"}. Asignales otro rol antes de eliminarlo.`);
    this.details = { memberCount };
  }
}

export class RoleNameTakenError extends DomainError {
  readonly code = "ROLE_NAME_TAKEN";
  constructor(message = "Ya hay un rol con ese nombre") {
    super(message);
  }
}
