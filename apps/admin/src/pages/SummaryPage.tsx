import type { ReactNode } from "react";
import { useCatalog } from "@/lib/catalog";
import { publicMenuHref } from "@/lib/public-link";
import { PUBLIC_BASE, publicMenuUrl, useMyRestaurant } from "@/lib/restaurant";
import { useSession } from "@/lib/session";

const WHATSAPP_TEST_MESSAGE = "Hola! Este es un mensaje de prueba de Menucito.";

/** `5491112345678` -> `+54 9 1112345678`; the area code length varies, so it is not split further. */
function formatWhatsapp(digits: string) {
  return `+${digits.slice(0, 2)} ${digits.slice(2, 3)} ${digits.slice(3)}`;
}

function whatsappTestUrl(digits: string) {
  return `https://wa.me/${digits}?text=${encodeURIComponent(WHATSAPP_TEST_MESSAGE)}`;
}

function Tile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-line bg-white p-5">
      <span className="text-sm text-muted">{label}</span>
      <b className="font-display text-[28px] font-extrabold">{value}</b>
    </div>
  );
}

/** "Resumen": the home of the panel, with real data only. */
export function SummaryPage() {
  const { data: session } = useSession();
  // `RequireRestaurant` guarantees the restaurant is loaded.
  const { data: restaurant } = useMyRestaurant();
  const { data: catalog } = useCatalog();
  if (!restaurant) return null;

  const firstName = session?.user.name?.trim().split(/\s+/)[0];
  // While the catalog loads, or if it fails, the tiles show "—" instead of an invented number.
  const usage = catalog?.usage;
  const products = usage ? (usage.maxProducts === null ? `${usage.products}` : `${usage.products} de ${usage.maxProducts}`) : "—";
  const categories = catalog ? `${catalog.categories.length}` : "—";

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Resumen</h1>
        <p className="m-0 text-[15px] text-muted">{firstName ? `Hola, ${firstName}` : "Hola"}</p>
      </div>

      <section aria-label="Tu link y tu WhatsApp" className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-6">
        <p className="m-0 text-sm text-muted">Tu link</p>
        <a
          href={publicMenuHref(PUBLIC_BASE, restaurant.slug)}
          target="_blank"
          rel="noopener noreferrer"
          className="m-0 flex min-h-11 items-center rounded-xl bg-addon px-3 py-2 text-[15px] font-bold break-all text-link underline-offset-2 hover:underline"
        >
          {publicMenuUrl(restaurant.slug)}
        </a>
        <p className="m-0 mt-2 text-sm text-muted">Tu WhatsApp</p>
        <p className="m-0 text-[15px] font-bold">{formatWhatsapp(restaurant.whatsapp)}</p>
        <a
          href={whatsappTestUrl(restaurant.whatsapp)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center self-start text-sm font-bold text-link underline-offset-2 hover:underline"
        >
          Enviar mensaje de prueba
        </a>
      </section>

      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
        <Tile label="Productos" value={products} />
        <Tile label="Categorías" value={categories} />
      </div>
    </div>
  );
}
