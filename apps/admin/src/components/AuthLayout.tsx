import type { ReactNode } from "react";

/** Split layout from the login canvas: dark brand panel on the left, content on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-wrap bg-bg text-ink">
      <aside className="box-border flex min-w-0 flex-[1_1_440px] flex-col justify-between gap-12 bg-ink p-14 text-white">
        <span className="font-display text-[26px] font-extrabold">
          menucito<span className="text-accent">.</span>
        </span>
        <div className="flex max-w-[460px] flex-col gap-5">
          <h2 className="m-0 font-display text-[44px] leading-[1.05] font-extrabold">
            Tu menú online. Los pedidos, directo a tu WhatsApp.
          </h2>
          <p className="m-0 text-[17px] leading-normal text-[#d6d3d1]">
            Cargá tus productos, compartí el link o el QR y recibí cada pedido ya escrito.
          </p>
        </div>
        <span className="text-[13px] text-[#d6d3d1]">Sin comisiones por pedido.</span>
      </aside>
      <main className="box-border flex min-w-0 flex-[1_1_440px] items-center justify-center px-8 py-14">
        <div className="flex w-full max-w-[400px] flex-col gap-5">{children}</div>
      </main>
    </div>
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="m-0 font-display text-[30px] font-extrabold">{children}</h1>;
}

type NoticeTone = "info" | "error" | "success" | "warning";

const NOTICE_STYLES: Record<NoticeTone, string> = {
  info: "border-line bg-white text-muted",
  error: "border-danger/30 bg-danger/5 text-danger",
  success: "border-success/30 bg-[#DCFCE7] font-bold text-success",
  warning: "border-warning/30 bg-[#FEF3C7] text-warning",
};

/** Check (success) and triangle (warning) icons; `error` and `info` have none. */
function NoticeIcon({ tone }: { tone: "success" | "warning" }) {
  return (
    <svg viewBox="0 0 24 24" className="mt-px size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {tone === "success" ? (
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      ) : (
        <>
          <path d="M12 3.5l9.5 16.5h-19z" />
          <path d="M12 10v4.5M12 17.5v.01" />
        </>
      )}
    </svg>
  );
}

/** Inline message. Errors are announced at once (`alert`); every other tone is a polite `status`. */
export function Notice({ tone = "info", children }: { tone?: NoticeTone; children: ReactNode }) {
  const icon = tone === "success" || tone === "warning";
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`m-0 rounded-xl border px-4 py-3 text-sm ${NOTICE_STYLES[tone]} ${icon ? "flex items-start gap-2.5" : ""}`}
    >
      {icon && <NoticeIcon tone={tone} />}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
