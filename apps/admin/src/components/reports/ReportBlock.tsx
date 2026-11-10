import type { ReactNode } from "react";

/** Card of a Reportes block: title, optional description and action on the right. */
export function ReportBlock({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="m-0 font-display text-xl font-extrabold">{title}</h2>
          {description && <p className="m-0 text-[13px] text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
