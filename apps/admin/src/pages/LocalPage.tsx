import { LogoUploader } from "@/components/LogoUploader";
import { useMyRestaurant } from "@/lib/restaurant";

/** "Mi local". For now only the "Apariencia" logo control; the rest of the canvas comes later. */
export function LocalPage() {
  // `RequireRestaurant` guarantees the restaurant is loaded.
  const { data: restaurant } = useMyRestaurant();
  if (!restaurant) return null;

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5">
      <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Mi local</h1>
      <section className="flex flex-col gap-3.5 rounded-2xl border border-line bg-white p-6">
        <h2 className="m-0 font-display text-xl font-extrabold">Apariencia</h2>
        <LogoUploader restaurant={restaurant} />
      </section>
    </div>
  );
}
