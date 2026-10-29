import { betterAuth } from "better-auth";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { sendEmail } from "./email";
import type { Env } from "./env";

export interface CreateAuthOptions {
  /** Workers `ctx.waitUntil`, so emails keep sending after the response is returned. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Builds the Better Auth instance. Workers bindings are only available per request,
 * so this is a factory instead of a module-level singleton.
 */
export function createAuth(env: Env, options: CreateAuthOptions = {}) {
  const db = drizzle(env.DB, { schema });
  const hasGoogle = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL, "http://localhost:5173"],
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    advanced: options.waitUntil ? { backgroundTasks: { handler: options.waitUntil } } : undefined,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Restablecé tu contraseña",
          intro: `Hola ${user.name}, recibimos un pedido para restablecer tu contraseña.`,
          cta: "Restablecer contraseña",
          link: url,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Confirmá tu email",
          intro: `Hola ${user.name}, confirmá tu email para activar tu cuenta.`,
          cta: "Confirmar email",
          link: url,
        });
      },
    },
    socialProviders: hasGoogle
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID as string,
            clientSecret: env.GOOGLE_CLIENT_SECRET as string,
          },
        }
      : {},
    hooks: {
      // With requireEmailVerification Better Auth answers duplicate sign-ups with a generic
      // success (anti-enumeration). The product spec wants an explicit "email already in use"
      // error, so we check up front.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email !== "string") return;
        const existing = await ctx.context.internalAdapter.findUserByEmail(email.toLowerCase());
        if (existing?.user) {
          throw APIError.from("UNPROCESSABLE_ENTITY", {
            code: "USER_ALREADY_EXISTS",
            message: "User already exists",
          });
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
