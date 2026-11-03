import { useId, type ReactNode } from "react";

interface SectionCardProps {
  title: string;
  description?: string;
  /** Control aligned with the title, at the right (e.g. a switch). */
  action?: ReactNode;
  children?: ReactNode;
}

/** White card of a settings screen: a titled `section` labelled by its heading. */
export function SectionCard({ title, description, action, children }: SectionCardProps) {
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
        <div className="flex items-start justify-between gap-4">
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
