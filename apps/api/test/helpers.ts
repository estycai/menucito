import { env } from "cloudflare:workers";
import { vi } from "vitest";
import app from "../src/index";
import type { PermissionKey, Role, Member } from "@menucito/shared";
import { createAuthAdmin } from "../src/auth-admin";
import type { Env } from "../src/env";

const ORIGIN = "http://localhost:5173";
const EMAIL_PREFIX = "[email:dev] ";

export interface CapturedEmail {
  to: string;
  subject: string;
  link: string;
}

/** Email sink: the dev fallback of `sendEmail` logs `[email:dev] {json}`; we capture it here. */
export function captureEmails() {
  const emails: CapturedEmail[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    const line = String(args[0] ?? "");
    if (line.startsWith(EMAIL_PREFIX)) emails.push(JSON.parse(line.slice(EMAIL_PREFIX.length)));
  });
  return {
    emails,
    last: () => emails[emails.length - 1] as CapturedEmail,
    restore: () => spy.mockRestore(),
  };
}

/** Minimal cookie jar: keeps `name=value` pairs from Set-Cookie headers. */
export class Client {
  private cookies = new Map<string, string>();

  /** `bindings` are merged over the test environment for every request (e.g. to turn a flag on). */
  constructor(private readonly bindings: Partial<Env> = {}) {}

  private absorb(res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair = ""] = raw.split(";");
      const idx = pair.indexOf("=");
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (value === "" || /max-age=0/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get hasSession() {
    return [...this.cookies.keys()].some((k) => k.includes("session_token"));
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("Origin")) headers.set("Origin", ORIGIN);
    // FormData bodies get their multipart Content-Type (with boundary) from the runtime.
    if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (this.cookies.size) {
      headers.set("Cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    }
    const res = await app.request(path, { ...init, headers, redirect: "manual" }, { ...env, ...this.bindings } as unknown as Env);
    this.absorb(res);
    return res;
  }

  get(path: string) {
    return this.request(path, { method: "GET" });
  }

  post(path: string, body: unknown) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  }

  patch(path: string, body: unknown) {
    return this.request(path, { method: "PATCH", body: JSON.stringify(body) });
  }

  put(path: string, body: unknown) {
    return this.request(path, { method: "PUT", body: JSON.stringify(body) });
  }

  delete(path: string) {
    return this.request(path, { method: "DELETE" });
  }

  /** Follows an absolute link from an email against the in-process app. */
  open(link: string) {
    const url = new URL(link);
    return this.request(url.pathname + url.search);
  }

  async session() {
    const res = await this.request("/api/auth/get-session");
    return (await res.json()) as { user: { name: string; email: string; emailVerified: boolean } } | null;
  }
}

export const TEST_PASSWORD = "password-123";

let sequence = 0;
/** A value that never repeats inside a test run (emails and slugs must be unique). */
export const unique = () => `${Date.now().toString(36)}${sequence++}`;

/** Reads the `error.code` of an API error response. */
export const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

/** A client signed in as an existing account (with a verified email), through the real sign-in endpoint. */
export async function signedInClient(email: string, password = TEST_PASSWORD, bindings: Partial<Env> = {}) {
  const client = new Client(bindings);
  const res = await client.post("/api/auth/sign-in/email", { email, password });
  if (res.status !== 200 || !client.hasSession) throw new Error(`Could not sign in ${email}: ${res.status}`);
  return client;
}

/** Creates an account with a verified email and no email sent (no sign-up flow, so no email sink is needed). */
export async function createVerifiedAccount(name = "Marta Gómez", email = `owner${unique()}@example.com`) {
  const { userId } = await (await createAuthAdmin(env as unknown as Env)).createCredentialUser({
    name,
    email,
    password: TEST_PASSWORD,
  });
  return { userId, email, password: TEST_PASSWORD };
}

export interface OwnerFixture {
  client: Client;
  userId: string;
  email: string;
  password: string;
  restaurantId: string;
  slug: string;
  /** The owner's member id (`GET /api/members` first row). */
  memberId: string;
}

/** A signed-in owner with a restaurant created through `POST /api/restaurants` (so it gets its role and member). */
export async function ownerWithRestaurant(
  options: { name?: string; bindings?: Partial<Env> } = {},
): Promise<OwnerFixture> {
  const account = await createVerifiedAccount(options.name ?? "Marta Gómez");
  const client = await signedInClient(account.email, account.password, options.bindings);
  const slug = `local-${unique()}`;
  const created = await client.post("/api/restaurants", {
    name: "Lo de Marta",
    slug,
    whatsapp: "11 1234-5678",
    delivery: true,
    takeaway: true,
  });
  if (created.status !== 201) throw new Error(`Could not create the restaurant: ${created.status}`);
  const restaurantId = ((await created.json()) as { id: string }).id;
  const members = (await (await client.get("/api/members")).json()) as { members: Member[] };
  return { client, ...account, restaurantId, slug, memberId: members.members[0]!.id };
}

export interface StaffFixture {
  client: Client;
  owner: OwnerFixture;
  userId: string;
  email: string;
  password: string;
  memberId: string;
  roleId: string;
}

/**
 * A signed-in staff member whose role grants exactly `permissions`. Built through the owner's API
 * (a new owner unless `owner` is given). `active: false` and `roleActive: false` deactivate the member
 * or its role after signing in, so the client keeps a session (the situation of scenario 14).
 */
export async function staffClient(options: {
  permissions: PermissionKey[];
  owner?: OwnerFixture;
  active?: boolean;
  roleActive?: boolean;
  isCourier?: boolean;
  bindings?: Partial<Env>;
}): Promise<StaffFixture> {
  const owner = options.owner ?? (await ownerWithRestaurant());
  const roleRes = await owner.client.post("/api/roles", { name: `Rol ${unique()}`, permissions: options.permissions });
  if (roleRes.status !== 201) throw new Error(`Could not create the role: ${roleRes.status}`);
  const role = (await roleRes.json()) as Role;

  const email = `staff${unique()}@example.com`;
  const memberRes = await owner.client.post("/api/members", {
    firstName: "Ana",
    lastName: "Pérez",
    email,
    password: TEST_PASSWORD,
    roleId: role.id,
    isCourier: options.isCourier ?? false,
  });
  if (memberRes.status !== 201) throw new Error(`Could not create the member: ${memberRes.status}`);
  const member = (await memberRes.json()) as Member;

  const client = await signedInClient(email, TEST_PASSWORD, options.bindings);
  const me = (await (await client.get("/api/restaurants/me")).json()) as { access: { memberId: string } };
  if (me.access.memberId !== member.id) throw new Error("The staff client resolved another member");

  if (options.roleActive === false) await owner.client.patch(`/api/roles/${role.id}`, { active: false });
  if (options.active === false) {
    // Deactivating deletes the sessions, so sign in again first would be refused: keep the old cookie
    // jar valid by deactivating directly in the database.
    await env.DB.prepare("UPDATE restaurant_members SET active = 0 WHERE id = ?").bind(member.id).run();
  }
  return { client, owner, userId: await userIdOf(member.id), email, password: TEST_PASSWORD, memberId: member.id, roleId: role.id };
}

async function userIdOf(memberId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT user_id FROM restaurant_members WHERE id = ?").bind(memberId).first<{ user_id: string }>();
  return row!.user_id;
}
