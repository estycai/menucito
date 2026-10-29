import { env } from "cloudflare:workers";
import { vi } from "vitest";
import app from "../src/index";
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
    headers.set("Origin", ORIGIN);
    // FormData bodies get their multipart Content-Type (with boundary) from the runtime.
    if (typeof init.body === "string") headers.set("Content-Type", "application/json");
    if (this.cookies.size) {
      headers.set("Cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    }
    const res = await app.request(path, { ...init, headers, redirect: "manual" }, env as unknown as Env);
    this.absorb(res);
    return res;
  }

  post(path: string, body: unknown) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
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
