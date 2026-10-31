import { useMemo, type CSSProperties } from "react";
import { formatArs, themeCssVars, themeFromColors, type Product, type Restaurant } from "@menucito/shared";
import type { AppearanceDraft } from "@/lib/appearance";
import { useCatalog } from "@/lib/catalog";
import { initials } from "@/lib/initials";

/** Shown when the restaurant has no featured category (or it has no products) yet. */
const EXAMPLE_FEATURED = { name: "Promos del día", products: [{ id: "example", name: "Combo completa + papas", description: "Hamburguesa completa con papas fritas medianas.", priceCents: 1_190_000, imageUrl: null }] };
const EXAMPLE_CHIPS = ["Hamburguesas", "Milanesas", "Bebidas"];
const EXAMPLE_PRODUCT = { name: "Hamburguesa completa", description: "Carne 180 g, queso, lechuga y tomate.", priceCents: 900_000, imageUrl: null };

type PreviewProduct = Pick<Product, "name" | "description" | "priceCents" | "imageUrl">;

/** `themeCssVars` is a ready-made `style` string; React needs an object. */
function cssVarsStyle(vars: string): CSSProperties {
  return Object.fromEntries(
    vars
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const [name = "", value = ""] = declaration.split(/:\s*/);
        return [name, value];
      }),
  ) as CSSProperties;
}

interface MenuPreviewProps {
  restaurant: Restaurant;
  /** Unsaved description and colors; the rest (cover, logo, catalog) is what is saved. */
  draft: AppearanceDraft;
}

/**
 * Phone-sized mini render of the public menu. It paints with the same `themeFromColors` as the
 * real menu and only reads data already in the query cache: typing never triggers a request.
 */
export function MenuPreview({ restaurant, draft }: MenuPreviewProps) {
  const { data: catalog } = useCatalog();
  const { background, primary } = draft.colors;
  const style = useMemo(
    () => cssVarsStyle(themeCssVars(themeFromColors({ background, primary }))),
    [background, primary],
  );

  const categories = catalog?.categories ?? [];
  const featuredCategory = categories.find((category) => category.featured && category.products.length > 0);
  const featured = featuredCategory ?? EXAMPLE_FEATURED;
  const regular = categories.filter((category) => !category.featured && category.products.length > 0);
  const chips = regular.length > 0 ? regular.map((category) => category.name) : EXAMPLE_CHIPS;
  const firstProduct: PreviewProduct = regular[0]?.products[0] ?? EXAMPLE_PRODUCT;

  return (
    <div
      // Purely visual duplicate of the form: hidden from assistive technology and not focusable.
      aria-hidden="true"
      inert
      style={style}
      className="relative h-[560px] w-[320px] max-w-full overflow-hidden rounded-[36px] border-8 border-[#1c1917] bg-bg font-sans text-ink"
    >
      {restaurant.coverUrl ? (
        <img src={restaurant.coverUrl} alt="" className="block h-24 w-full object-cover" />
      ) : (
        <div className="h-24 bg-[var(--color-cover)]" />
      )}

      <div className="-mt-[26px] flex flex-col gap-[5px] px-3.5">
        {restaurant.logoUrl ? (
          <img src={restaurant.logoUrl} alt="" className="size-[52px] rounded-[15px] border-[3px] border-bg bg-[var(--color-surface)] object-contain" />
        ) : (
          <div className="flex size-[52px] items-center justify-center rounded-[15px] border-[3px] border-bg bg-primary font-display text-lg font-extrabold text-[var(--color-on-primary)]">
            {initials(restaurant.name)}
          </div>
        )}
        <span className="font-display text-xl leading-[1.1] font-extrabold break-words">{restaurant.name}</span>
        {draft.description && <span className="text-[11px] leading-[1.4] text-muted">{draft.description}</span>}
      </div>

      <div className="pt-3">
        <div className="flex items-center gap-1.5 px-3.5 pb-1.5">
          <span className="text-[13px] leading-none text-link">★</span>
          <span className="truncate font-display text-sm font-extrabold">{featured.name}</span>
        </div>
        <div className="flex gap-2 overflow-hidden px-3.5">
          {featured.products.slice(0, 3).map((product) => (
            <div key={product.id} className="w-[150px] shrink-0 overflow-hidden rounded-xl border border-line bg-[var(--color-surface)]">
              {product.imageUrl ? (
                <img src={product.imageUrl} alt="" className="block h-[70px] w-full object-cover" />
              ) : (
                <div className="h-[70px] bg-[var(--color-cover)]" />
              )}
              <div className="flex flex-col px-[9px] pt-1.5 pb-2">
                <span className="truncate text-[11px] font-bold">{product.name}</span>
                {product.description && <span className="line-clamp-2 text-[10px] leading-[1.35] text-muted">{product.description}</span>}
                <span className="text-xs font-bold text-link">{formatArs(product.priceCents)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 overflow-hidden px-3.5 pt-2.5">
        {chips.map((name, index) => (
          <span
            key={`${index}-${name}`}
            className={
              index === 0
                ? "shrink-0 rounded-full bg-primary px-3 py-[7px] text-[11px] font-bold text-[var(--color-on-primary)]"
                : "shrink-0 rounded-full border border-line bg-[var(--color-surface)] px-3 py-[7px] text-[11px]"
            }
          >
            {name}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 px-3.5 pt-2">
        <span className="truncate font-display text-sm font-extrabold">{chips[0]}</span>
        <div className="flex gap-2 rounded-xl border border-line bg-[var(--color-surface)] p-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[11px] font-bold">{firstProduct.name}</span>
            {firstProduct.description && <span className="line-clamp-2 text-[10px] text-muted">{firstProduct.description}</span>}
            <span className="text-xs font-bold text-link">{formatArs(firstProduct.priceCents)}</span>
          </div>
          {firstProduct.imageUrl ? (
            <img src={firstProduct.imageUrl} alt="" className="size-11 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="size-11 shrink-0 rounded-lg bg-[var(--color-cover)]" />
          )}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 border-t border-line bg-bg px-3.5 pt-2 pb-3">
        <div className="flex min-h-[38px] items-center justify-between rounded-[10px] bg-primary px-3 text-xs font-bold text-[var(--color-on-primary)]">
          <span>Ver pedido · 3</span>
          <span>$28.500</span>
        </div>
      </div>
    </div>
  );
}
