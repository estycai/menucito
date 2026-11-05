import { createAuth } from "./auth";
import type { Env } from "./env";
import { asUniqueViolation } from "./repositories/errors";

/** The email already belongs to an account (of another restaurant, an owner, or someone who signed up alone). */
export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super("An account with this email already exists");
    this.name = "EmailAlreadyRegisteredError";
  }
}

/**
 * Account administration for the restaurant owner, on top of Better Auth's internal context. It
 * creates, re-keys and deletes accounts without going through `/api/auth/*`, so no new endpoint is
 * exposed there and no email is sent. We deliberately do not use Better Auth's `admin` plugin: it
 * adds a platform-wide administrator role and its own endpoints.
 *
 * Better Auth writes on its own, outside any D1 batch of ours; callers compensate when a later step fails.
 */
export interface AuthAdmin {
  /**
   * Creates a user with a verified email and a credential account holding the hashed password.
   * Throws `EmailAlreadyRegisteredError` when the email exists (never attaches to an existing account).
   */
  createCredentialUser(input: { name: string; email: string; password: string }): Promise<{ userId: string }>;
  /** Keeps the account's display name (used in emails) in step with the member's name. */
  renameUser(userId: string, name: string): Promise<void>;
  /** Replaces the credential password of the user. */
  setPassword(userId: string, password: string): Promise<void>;
  /** Deletes every session of the user (they have to sign in again). */
  revokeSessions(userId: string): Promise<void>;
  /** Deletes the user with its sessions and accounts (the member row cascades from the database). */
  deleteUser(userId: string): Promise<void>;
}

export async function createAuthAdmin(env: Env): Promise<AuthAdmin> {
  const ctx = await createAuth(env).$context;
  const adapter = ctx.internalAdapter;

  return {
    async createCredentialUser({ name, email, password }) {
      const normalizedEmail = email.trim().toLowerCase();
      if ((await adapter.findUserByEmail(normalizedEmail))?.user) throw new EmailAlreadyRegisteredError();

      const hash = await ctx.password.hash(password);
      let userId: string;
      try {
        const created = await adapter.createUser({ name, email: normalizedEmail, emailVerified: true }, { method: "admin" });
        userId = created.id;
      } catch (error) {
        // Two owners creating the same email at once: the database UNIQUE is the real guard.
        if (asUniqueViolation(error)?.columns.includes("email")) throw new EmailAlreadyRegisteredError();
        throw error;
      }

      try {
        await adapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: hash });
      } catch (error) {
        // A user without credentials would be a dead account that still blocks the email.
        await adapter.deleteUser(userId).catch(() => undefined);
        throw error;
      }
      return { userId };
    },

    async renameUser(userId, name) {
      await adapter.updateUser(userId, { name });
    },

    async setPassword(userId, password) {
      await adapter.updatePassword(userId, await ctx.password.hash(password));
    },

    async revokeSessions(userId) {
      await adapter.deleteUserSessions(userId);
    },

    async deleteUser(userId) {
      await adapter.deleteUser(userId);
    },
  };
}
