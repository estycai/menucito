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

export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  const styles =
    tone === "error"
      ? "border-danger/30 bg-danger/5 text-danger"
      : "border-line bg-white text-muted";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`m-0 rounded-xl border px-4 py-3 text-sm ${styles}`}>
      {children}
    </p>
  );
}
