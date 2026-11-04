import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title: string;
  description?: string;
  /** Control aligned with the title, at the right (e.g. a switch). */
  action?: ReactNode;
  /** Vertical alignment of `action`: with the title (default) or centered on title and description. */
  actionAlign?: "start" | "center";
  children?: ReactNode;
}

/** White card of a settings screen: a titled `section` labelled by its heading. */
export function SectionCard({ title, description, action, actionAlign = "start", children }: SectionCardProps) {
  const titleId = useId();
  const heading = (
    <div className="flex flex-col gap-1">
      <h2 id={titleId} className="m-0 font-display text-xl font-extrabold">
        {title}
      </h2>
      {description && <p className="m-0 text-[13px] text-muted">{description}</p>}
    </div>
  );

  return (
    <section
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-white p-4 sm:p-6"
    >
      {action ? (
        <div className={cn("flex justify-between gap-4", actionAlign === "center" ? "items-center" : "items-start")}>
          {heading}
          {action}
        </div>
      ) : (
        heading
      )}
      {children}
    </section>
  );
}
