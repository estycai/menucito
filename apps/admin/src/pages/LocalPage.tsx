import { Link } from "react-router";
import { LogoUploader } from "@/components/LogoUploader";
import { useMyRestaurant } from "@/lib/restaurant";

/** "Mi local". For now only the "Apariencia" logo control; the rest of the canvas comes later. */
export function LocalPage() {
  // `RequireRestaurant` guarantees the restaurant is loaded.
  const { data: restaurant } = useMyRestaurant();
  if (!restaurant) return null;

  return (
    <div className="min-h-screen bg-bg px-8 py-8 text-ink">
      <main className="mx-auto flex w-full max-w-[640px] flex-col gap-5">
        <Link to="/" className="inline-flex min-h-11 items-center self-start text-sm font-bold text-link underline-offset-2 hover:underline">
          Volver al inicio
        </Link>
        <h1 className="m-0 font-display text-[32px] font-extrabold">Mi local</h1>
        <section className="flex flex-col gap-3.5 rounded-2xl border border-line bg-white p-6">
          <h2 className="m-0 font-display text-xl font-extrabold">Apariencia</h2>
          <LogoUploader restaurant={restaurant} />
        </section>
      </main>
    </div>
  );
}
