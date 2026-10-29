import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { ProBadge } from "@/components/ProBadge";

interface ProLockProps {
  title: string;
  /** One line that says what the feature does. */
  description: string;
  /** `true` on accounts whose plan does not include the feature: shows the lock reason and the upgrade link. */
  planLocked?: boolean;
  /** `true` when the feature does not exist yet (any plan). */
  comingSoon?: boolean;
  /**
   * What to show inside: a static example (never real inputs) or read-only saved data. Wrap purely
   * decorative markup in `inert` so it is neither focusable nor read as content.
   */
  children?: ReactNode;
}

/**
 * Locked state of a Pro feature. It is not a disabled form: nothing inside can be focused or
 * activated, the lock reason is plain text (not only color or opacity) and the only interactive
 * element is the "Ver plan Pro" link.
 */
export function ProLock({ title, description, planLocked = true, comingSoon = false, children }: ProLockProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-dashed border-[#a8a29e] bg-addon p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 id={headingId} className="m-0 font-display text-xl font-extrabold text-ink">
          {title}
        </h2>
        <ProBadge />
      </div>
      <p className="m-0 text-[15px] text-muted">{description}</p>
      {children}
      {(planLocked || comingSoon) && (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="m-0 flex flex-wrap gap-x-2 text-sm font-bold text-ink">
            {comingSoon && <span>Próximamente</span>}
            {comingSoon && planLocked && <span aria-hidden="true">·</span>}
            {planLocked && <span>Disponible en el plan Pro</span>}
          </p>
          {planLocked && (
            <Link
              to="/plan"
              className="-ml-1 inline-flex min-h-11 items-center self-start rounded-lg px-1 text-sm font-bold text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:ml-0"
            >
              Ver plan Pro
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
