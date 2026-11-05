import { Link } from "react-router";
import { useAccess } from "@/lib/access";
import { visibleNavItems } from "@/lib/nav";
import { useDocumentTitle } from "@/lib/use-document-title";

/** Shown inside the shell when the member opens a section they have no permission for. */
export function NoAccess() {
  const { access } = useAccess();
  useDocumentTitle("Sin acceso");
  const first = visibleNavItems(access)[0];

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3 rounded-2xl border border-line bg-white p-6 text-center sm:p-10">
      {first ? (
        <>
          <h1 className="m-0 font-display text-2xl font-extrabold">No tenés acceso a esta sección</h1>
          <p className="m-0 text-[15px] text-muted">Si lo necesitás, pedile acceso al dueño del local.</p>
          <Link
            to={first.to}
            className="mx-auto inline-flex min-h-11 items-center font-bold text-link underline-offset-2 hover:underline"
          >
            Ir a {first.label}
          </Link>
        </>
      ) : (
        <>
          <h1 className="m-0 font-display text-2xl font-extrabold">Sin acceso</h1>
          <p className="m-0 text-[15px] text-muted">{NO_SECTIONS_MESSAGE}</p>
        </>
      )}
    </div>
  );
}

export const NO_SECTIONS_MESSAGE = "Todavía no tenés acceso a ninguna sección. Hablá con el dueño del local.";
