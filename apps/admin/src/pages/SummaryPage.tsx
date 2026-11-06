import type { ReactNode } from "react";
import { Link } from "react-router";
import { Notice } from "@/components/AuthLayout";
import { MenuQr } from "@/components/MenuQr";
import { useAccess } from "@/lib/access";
import { useCashCurrent } from "@/lib/cash";
import { useCatalog } from "@/lib/catalog";
import { useLifetimeTotals } from "@/lib/orders";
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
  const { can } = useAccess();
  // The product and category counts come from the menu: only members who can see it get them.
  const canSeeMenu = can("menu.view");
  const canSeeCash = can("cash.view");
  const canSeeQr = can("qr.view");
  const totals = useLifetimeTotals(can("summary.view"));
  const canCloseCash = can("cash.close");
  const { data: catalog } = useCatalog(canSeeMenu);
  const cash = useCashCurrent(canSeeCash);
  if (!restaurant) return null;

  const menuHref = publicMenuHref(PUBLIC_BASE, restaurant.slug);
  const firstName =session?.user.name?.trim().split(/\s+/)[0];
  // While the catalog loads, or if it fails, the tiles show "—" instead of an invented number.
  const usage = catalog?.usage;
  const products = usage ? (usage.maxProducts === null ? `${usage.products}` : `${usage.products} de ${usage.maxProducts}`) : "—";
  const categories = catalog ? `${catalog.categories.length}` : "—";
  const orderCount = totals.data ? `${totals.data.orders}` : "—";
  const customerCount = totals.data ? `${totals.data.customers}` : "—";

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Resumen</h1>
        <p className="m-0 text-[15px] text-muted">{firstName ? `Hola, ${firstName}` : "Hola"}</p>
      </div>

      {canCloseCash && cash.data?.session && cash.data.storeClosed && (
        <Notice tone="warning">
          <b>El local ya cerró.</b> Cerrá la caja para hacer el arqueo.{" "}
          <Link to="/cajas" className="font-bold underline">
            Ir a Cajas
          </Link>
        </Notice>
      )}

      <section
        aria-label="Tu link, tu QR y tu WhatsApp"
        className="flex flex-col gap-6 rounded-2xl border border-line bg-white p-6 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="m-0 text-sm text-muted">Tu link</p>
          <a
            href={menuHref}
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
        </div>
        {canSeeQr && <MenuQr href={menuHref} slug={restaurant.slug} />}
      </section>

      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
        <Tile label="Pedidos (histórico)" value={orderCount} />
        <Tile label="Clientes (histórico)" value={customerCount} />
        {canSeeMenu && (
          <>
            <Tile label="Productos" value={products} />
            <Tile label="Categorías" value={categories} />
          </>
        )}
      </div>
    </div>
  );
}
