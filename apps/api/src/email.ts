import type { Env } from "./env";

export interface EmailMessage {
  to: string;
  subject: string;
  /** Action link included in the email (verification, reset, ...). */
  link: string;
  /** Short lead-in text shown above the button. */
  intro: string;
  /** Button label. */
  cta: string;
}

type EmailEnv = Pick<Env, "RESEND_API_KEY" | "EMAIL_FROM">;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderHtml(m: EmailMessage): string {
  const link = escapeHtml(m.link);
  return `<div style="font-family:Arial,sans-serif;color:#1C1917;max-width:480px;margin:0 auto;padding:24px">
<p style="font-size:22px;font-weight:800;margin:0 0 16px">menucito<span style="color:#FB923C">.</span></p>
<p style="font-size:16px;line-height:1.5">${escapeHtml(m.intro)}</p>
<p><a href="${link}" style="display:inline-block;background:#C2410C;color:#fff;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:700">${escapeHtml(m.cta)}</a></p>
<p style="font-size:13px;color:#57534E">Si el botón no funciona, copiá este enlace en tu navegador:<br>${link}</p>
</div>`;
}

/**
 * Sends a transactional email through the Resend REST API.
 * When RESEND_API_KEY is missing (local dev) the email is logged to the console instead.
 */
export async function sendEmail(env: EmailEnv, message: EmailMessage): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email:dev] ${JSON.stringify({ to: message.to, subject: message.subject, link: message.link })}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM ?? "onboarding@resend.dev",
      to: [message.to],
      subject: message.subject,
      html: renderHtml(message),
    }),
  });

  if (!res.ok) {
    // Do not throw: a failed email must not break the auth request (the user can resend).
    console.error(`[email] Resend responded ${res.status}: ${await res.text()}`);
  }
}
