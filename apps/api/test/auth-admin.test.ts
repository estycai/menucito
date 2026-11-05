import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthAdmin, EmailAlreadyRegisteredError } from "../src/auth-admin";
import type { Env } from "../src/env";
import { Client, TEST_PASSWORD, captureEmails, signedInClient, unique } from "./helpers";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

const admin = () => createAuthAdmin(env as unknown as Env);
const emailOf = () => `admin${unique()}@example.com`;

const userRow = (email: string) =>
  env.DB.prepare("SELECT id, name, email, email_verified FROM user WHERE email = ?").bind(email).first<{
    id: string;
    name: string;
    email: string;
    email_verified: number;
  }>();

const count = async (sql: string, ...params: unknown[]) =>
  (await env.DB.prepare(sql).bind(...params).first<{ n: number }>())!.n;

describe("createCredentialUser", () => {
  it("creates a user with a verified email and a hashed credential password, without sending any email", async () => {
    const email = emailOf();
    const { userId } = await (await admin()).createCredentialUser({ name: "Ana Pérez", email, password: TEST_PASSWORD });

    expect(await userRow(email)).toEqual({ id: userId, name: "Ana Pérez", email, email_verified: 1 });
    const account = await env.DB.prepare("SELECT provider_id, account_id, password FROM account WHERE user_id = ?")
      .bind(userId)
      .first<{ provider_id: string; account_id: string; password: string }>();
    expect(account).toMatchObject({ provider_id: "credential", account_id: userId });
    expect(account!.password).toBeTruthy();
    expect(account!.password).not.toContain(TEST_PASSWORD);
    expect(sink.emails).toHaveLength(0);
  });

  it("lets the person sign in on the first attempt (no verification step)", async () => {
    const email = emailOf();
    await (await admin()).createCredentialUser({ name: "Ana Pérez", email, password: TEST_PASSWORD });
    const client = new Client();
    const res = await client.post("/api/auth/sign-in/email", { email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(client.hasSession).toBe(true);
    expect(sink.emails).toHaveLength(0);
  });

  it("lowercases the email", async () => {
    const email = emailOf();
    await (await admin()).createCredentialUser({ name: "Ana", email: email.toUpperCase(), password: TEST_PASSWORD });
    expect(await userRow(email)).not.toBeNull();
  });

  it("refuses an email that already has an account, in any casing, and creates nothing", async () => {
    const email = emailOf();
    const auth = await admin();
    await auth.createCredentialUser({ name: "Ana", email, password: TEST_PASSWORD });
    const users = await count("SELECT count(*) AS n FROM user");
    const accounts = await count("SELECT count(*) AS n FROM account");

    await expect(auth.createCredentialUser({ name: "Otra", email, password: TEST_PASSWORD })).rejects.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
    await expect(
      auth.createCredentialUser({ name: "Otra", email: email.toUpperCase(), password: TEST_PASSWORD }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
    expect(await count("SELECT count(*) AS n FROM user")).toBe(users);
    expect(await count("SELECT count(*) AS n FROM account")).toBe(accounts);
  });

  it("refuses the email of someone who signed up alone", async () => {
    const email = emailOf();
    await new Client().post("/api/auth/sign-up/email", { name: "Solo", email, password: TEST_PASSWORD, callbackURL: "/" });
    await expect((await admin()).createCredentialUser({ name: "Ana", email, password: TEST_PASSWORD })).rejects.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
  });
});

describe("setPassword", () => {
  it("replaces the credential: the new password signs in, the old one does not", async () => {
    const email = emailOf();
    const auth = await admin();
    const { userId } = await auth.createCredentialUser({ name: "Ana", email, password: TEST_PASSWORD });
    await auth.setPassword(userId, "another-password-1");

    expect((await new Client().post("/api/auth/sign-in/email", { email, password: TEST_PASSWORD })).status).toBe(401);
    const client = new Client();
    expect((await client.post("/api/auth/sign-in/email", { email, password: "another-password-1" })).status).toBe(200);
    expect(client.hasSession).toBe(true);
  });
});

describe("revokeSessions", () => {
  it("makes every open session stop working", async () => {
    const email = emailOf();
    const auth = await admin();
    const { userId } = await auth.createCredentialUser({ name: "Ana", email, password: TEST_PASSWORD });
    const first = await signedInClient(email);
    const second = await signedInClient(email);
    expect(await first.session()).not.toBeNull();

    await auth.revokeSessions(userId);
    expect(await count("SELECT count(*) AS n FROM session WHERE user_id = ?", userId)).toBe(0);
    expect(await first.session()).toBeNull();
    expect(await second.session()).toBeNull();
  });
});

describe("renameUser", () => {
  it("changes the display name of the account", async () => {
    const email = emailOf();
    const auth = await admin();
    const { userId } = await auth.createCredentialUser({ name: "Ana", email, password: TEST_PASSWORD });
    await auth.renameUser(userId, "Ana María Pérez");
    expect((await userRow(email))!.name).toBe("Ana María Pérez");
  });
});

describe("deleteUser", () => {
  it("removes the user with its accounts and sessions, and frees the email", async () => {
    const email = emailOf();
    const auth = await admin();
    const { userId } = await auth.createCredentialUser({ name: "Ana", email, password: TEST_PASSWORD });
    await signedInClient(email);

    await auth.deleteUser(userId);
    expect(await userRow(email)).toBeNull();
    expect(await count("SELECT count(*) AS n FROM account WHERE user_id = ?", userId)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM session WHERE user_id = ?", userId)).toBe(0);
    await auth.createCredentialUser({ name: "Ana", email, password: TEST_PASSWORD });
  });
});

describe("no new endpoint under /api/auth", () => {
  it.each([
    ["POST", "/api/auth/admin/create-user"],
    ["POST", "/api/auth/admin/set-user-password"],
    ["GET", "/api/auth/admin/list-users"],
    ["POST", "/api/auth/admin/remove-user"],
  ])("%s %s is not served", async (method, path) => {
    const res = await new Client().request(path, { method, body: method === "POST" ? "{}" : undefined });
    expect(res.status).toBe(404);
  });
});
