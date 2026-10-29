import { createAuthClient } from "better-auth/react";

// No baseURL: requests go to the current origin (/api/auth), which Vite proxies to the API in dev.
export const authClient = createAuthClient();

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Email o contraseña incorrectos.",
  EMAIL_NOT_VERIFIED: "Tenés que verificar tu email antes de ingresar.",
  USER_ALREADY_EXISTS: "Ese email ya está en uso.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Ese email ya está en uso.",
  INVALID_TOKEN: "El enlace es inválido o venció.",
  PASSWORD_TOO_SHORT: "La contraseña debe tener al menos 8 caracteres.",
};

export interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

export function authErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (error?.code && MESSAGES[error.code]) return MESSAGES[error.code] as string;
  return "Algo salió mal. Probá de nuevo en un momento.";
}

/** Error thrown from mutation functions so callers can branch on the Better Auth error code. */
export class AuthError extends Error {
  readonly code?: string;
  constructor(error: AuthErrorLike) {
    super(authErrorMessage(error));
    this.code = error.code;
  }
}

/** Unwraps a Better Auth `{ data, error }` result, throwing `AuthError` on failure. */
export function unwrap<T>(result: { data: T | null; error: AuthErrorLike | null }): T {
  if (result.error) throw new AuthError(result.error);
  return result.data as T;
}
