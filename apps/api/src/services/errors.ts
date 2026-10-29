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

/** Invalid input detected by a service (beyond the route's schema validation). */
export class ValidationError extends DomainError {
  readonly code = "VALIDATION_ERROR";
}
