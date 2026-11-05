import { Button } from "@/components/ui/button";
import { useSignOut } from "@/lib/session";
import { useDocumentTitle } from "@/lib/use-document-title";

/** Full-screen state of a deactivated member: the owner has to turn them on again. */
export function MemberInactive() {
  const signOut = useSignOut();
  useDocumentTitle("Usuario desactivado");

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-ink">
      <div className="flex w-full max-w-[440px] flex-col items-center gap-5 rounded-2xl border border-line bg-white p-8 text-center">
        <span className="font-display text-[22px] font-extrabold">
          menucito<span className="text-accent">.</span>
        </span>
        <h1 className="m-0 text-[17px] leading-snug font-bold">
          Tu usuario está desactivado. Hablá con el dueño del local.
        </h1>
        <Button type="button" variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()} className="px-6">
          Cerrar sesión
        </Button>
      </div>
    </main>
  );
}
