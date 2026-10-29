import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client, captureEmails } from "./helpers";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

let counter = 0;
const newUser = () => ({
  name: "Marta",
  email: `marta${Date.now()}${counter++}@example.com`,
  password: "password-123",
});

type TestUser = ReturnType<typeof newUser>;

const signUp = (client: Client, user: TestUser) => client.post("/api/auth/sign-up/email", { ...user, callbackURL: "/" });
const signIn = (client: Client, email: string, password: string) =>
  client.post("/api/auth/sign-in/email", { email, password });

/** Signs up and verifies a user; returns a fresh (logged-out) client. */
async function verifiedUser() {
  const user = newUser();
  await signUp(new Client(), user);
  await new Client().open(sink.last().link);
  return { user, client: new Client() };
}

describe("health", () => {
  it("responds ok", async () => {
    const res = await new Client().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("sign up", () => {
  it("creates the account, sends a verification email and does not open a session", async () => {
    const user = newUser();
    const client = new Client();
    const res = await signUp(client, user);
    expect(res.status).toBe(200);
    expect(client.hasSession).toBe(false);
    expect(sink.emails).toHaveLength(1);
    expect(sink.last().to).toBe(user.email);
    expect(sink.last().link).toContain("/api/auth/verify-email?token=");
  });

  it("rejects an email that is already registered", async () => {
    const user = newUser();
    await signUp(new Client(), user);
    const res = await signUp(new Client(), user);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe("USER_ALREADY_EXISTS");
  });

  it("rejects short passwords", async () => {
    const res = await signUp(new Client(), { ...newUser(), password: "short" });
    expect(res.status).toBe(400);
  });
});

describe("login", () => {
  it("blocks unverified accounts and resends the verification email", async () => {
    const user = newUser();
    await signUp(new Client(), user);
    sink.emails.length = 0;

    const client = new Client();
    const res = await signIn(client, user.email, user.password);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("EMAIL_NOT_VERIFIED");
    expect(client.hasSession).toBe(false);
    expect(sink.emails).toHaveLength(1);
  });

  it("resends the verification email on demand", async () => {
    const user = newUser();
    await signUp(new Client(), user);
    sink.emails.length = 0;
    const res = await new Client().post("/api/auth/send-verification-email", { email: user.email, callbackURL: "/" });
    expect(res.status).toBe(200);
    expect(sink.emails).toHaveLength(1);
  });

  it("verifies the email through the link and signs the user in", async () => {
    const user = newUser();
    await signUp(new Client(), user);
    const client = new Client();
    const res = await client.open(sink.last().link);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const session = await client.session();
    expect(session?.user).toMatchObject({ name: "Marta", email: user.email, emailVerified: true });
  });

  it("logs in a verified account", async () => {
    const { user, client } = await verifiedUser();
    const res = await signIn(client, user.email, user.password);
    expect(res.status).toBe(200);
    expect((await client.session())?.user.name).toBe("Marta");
  });

  it("rejects wrong credentials", async () => {
    const { user, client } = await verifiedUser();
    const res = await signIn(client, user.email, "wrong-password");
    expect(res.status).toBe(401);
    expect(client.hasSession).toBe(false);
  });
});

describe("session and sign out", () => {
  it("has no session by default", async () => {
    expect(await new Client().session()).toBeNull();
  });

  it("ends the session on sign out", async () => {
    const { user, client } = await verifiedUser();
    await signIn(client, user.email, user.password);
    expect(await client.session()).not.toBeNull();
    const res = await client.post("/api/auth/sign-out", {});
    expect(res.status).toBe(200);
    expect(await client.session()).toBeNull();
  });
});

describe("forgot and reset password", () => {
  const forgot = (client: Client, email: string) =>
    client.post("/api/auth/request-password-reset", { email, redirectTo: "/reset-password" });

  it("answers neutrally for unknown emails and sends nothing", async () => {
    const res = await forgot(new Client(), "nobody@example.com");
    expect(res.status).toBe(200);
    expect(sink.emails).toHaveLength(0);
  });

  it("emails a reset link, resets the password and revokes old sessions", async () => {
    const { user, client: loggedIn } = await verifiedUser();
    await signIn(loggedIn, user.email, user.password);
    expect(await loggedIn.session()).not.toBeNull();
    sink.emails.length = 0;

    const res = await forgot(new Client(), user.email);
    expect(res.status).toBe(200);
    expect(sink.emails).toHaveLength(1);

    // The link redirects to the frontend route with ?token=...
    const redirect = await new Client().open(sink.last().link);
    expect(redirect.status).toBe(302);
    const location = new URL(redirect.headers.get("location") ?? "", "http://localhost:5173");
    expect(location.pathname).toBe("/reset-password");
    const token = location.searchParams.get("token") ?? "";
    expect(token).not.toBe("");

    const reset = await new Client().post("/api/auth/reset-password", { newPassword: "brand-new-pass-1", token });
    expect(reset.status).toBe(200);

    expect(await loggedIn.session()).toBeNull();

    const fresh = new Client();
    expect((await signIn(fresh, user.email, user.password)).status).toBe(401);
    expect((await signIn(fresh, user.email, "brand-new-pass-1")).status).toBe(200);
  });

  it("redirects invalid reset links with an error", async () => {
    const res = await new Client().request("/api/auth/reset-password/not-a-real-token?callbackURL=%2Freset-password");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "", "http://localhost:5173");
    expect(location.pathname).toBe("/reset-password");
    expect(location.searchParams.get("error")).toBe("INVALID_TOKEN");
  });

  it("rejects reset with an invalid token", async () => {
    const res = await new Client().post("/api/auth/reset-password", { newPassword: "brand-new-pass-1", token: "bogus" });
    expect(res.status).toBe(400);
  });
});
