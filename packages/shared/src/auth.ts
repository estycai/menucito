import { z } from "zod";

export const MIN_PASSWORD_LENGTH = 8;

const email = z.string().trim().min(1, "Ingresá tu email").email("Email inválido");
const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Ingresá tu nombre").max(80, "Nombre demasiado largo"),
  email,
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Ingresá tu contraseña"),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({ password });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
