import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CATALOG_MESSAGES, formatArs, type CatalogUsage, type CategoryWithProducts, type Product } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { CategoryNameForm } from "@/components/CategoryNameForm";
import { ReorderButtons } from "@/components/ReorderButtons";
import { Button } from "@/components/ui/button";
import {
  useCatalog,
  useCreateCategory,
  useDeleteCategory,
  useRenameCategory,
  useReorderCategories,
  useReorderProducts,
  useToggleAvailability,
} from "@/lib/catalog";
import { moveId } from "@/lib/order";
import { planName } from "@/lib/plans";
import { ApiError, useMyRestaurant } from "@/lib/restaurant";
import { cn } from "@/lib/utils";

/** `?category=all` shows every category's products instead of one. */
const ALL_CATEGORIES = "all";

const confirmDelete =(name: string) => window.confirm(`¿Eliminar «${name}»? No se puede deshacer.`);

function usageText(usage: CatalogUsage, plan: string) {
  return usage.maxProducts === null
    ? `${usage.products} productos`
    : `${usage.products} de ${usage.maxProducts} productos en el plan ${planName(plan)}`;
}

/** "Mi menú": categories (aside on desktop, chips on phones) and the products of the selected one. */
export function MenuPage() {
  const navigate = useNavigate();
  // `RequireRestaurant` guarantees the restaurant is loaded.
  const { data: restaurant } = useMyRestaurant();
  const { data: catalog, isPending, isError } = useCatalog();
  // The selected category lives in the URL, so coming back from the editor keeps it.
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("category");
  const setSelectedId = (id: string) => setParams({ category: id }, { replace: true });
  const [creating, setCreating] = useState(false);
  const createCategory = useCreateCategory();

  if (!restaurant) return null;

  const categories = catalog?.categories ?? [];
  const showAll = selectedId === ALL_CATEGORIES && categories.length > 0;
  const selected = showAll ? null : (categories.find((category) => category.id === selectedId) ?? categories[0] ?? null);
  const usage = catalog?.usage;
  const atLimit = Boolean(usage && usage.maxProducts !== null && usage.products >= usage.maxProducts);
  const canCreateProduct = categories.length > 0 && !atLimit;

  function newProduct() {
    // The editor falls back to the first category when none is requested.
    navigate(selected ? `/menu/products/new?category=${encodeURIComponent(selected.id)}` : "/menu/products/new");
  }

  const newProductButton = (className: string) => (
    <Button type="button" className={cn("min-h-12 rounded-xl px-[22px] text-[15px]", className)} disabled={!canCreateProduct} onClick={newProduct}>
      Nuevo producto
    </Button>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 pb-20 md:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Mi menú</h1>
          {usage && <span className="text-sm text-muted">{usageText(usage, restaurant.plan)}</span>}
        </div>
        {newProductButton("hidden md:inline-flex")}
      </div>

      {atLimit && <Notice tone="error">Llegaste al límite de productos del plan {planName(restaurant.plan)}.</Notice>}

      {isPending ? (
        <p className="m-0 text-muted">Cargando tu menú...</p>
      ) : isError ? (
        <Notice tone="error">No pudimos cargar tu menú. Recargá la página para intentar de nuevo.</Notice>
      ) : (
        <div className="flex flex-col gap-5 md:flex-row md:items-start">
          <nav aria-label="Categorías" className="min-w-0 md:w-[260px] md:shrink-0">
            <div className="flex flex-col gap-2 md:gap-1 md:rounded-2xl md:border md:border-line md:bg-white md:p-3">
              <span className="hidden px-2.5 py-2 text-xs font-bold tracking-[.05em] text-muted md:block">CATEGORÍAS</span>
              <ul className="-mx-4 m-0 flex list-none gap-2 overflow-x-auto px-4 pb-1 sm:-mx-8 sm:px-8 md:mx-0 md:flex-col md:gap-1 md:overflow-visible md:px-0 md:pb-0">
                {categories.length > 1 && (
                  <li className="shrink-0">
                    <button
                      type="button"
                      aria-current={showAll ? "true" : undefined}
                      onClick={() => setSelectedId(ALL_CATEGORIES)}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-[15px] whitespace-nowrap md:w-full md:justify-between md:rounded-[10px] md:border-0 md:px-3",
                        showAll ? "border-[#FDBA74] bg-[#FFEDD5] font-bold text-link" : "border-line bg-white text-ink md:hover:bg-bg",
                      )}
                    >
                      <span>Ver todas</span>
                      <span className={cn("text-[13px]", !showAll && "text-muted")}>
                        {categories.reduce((total, category) => total + category.products.length, 0)}
                      </span>
                    </button>
                  </li>
                )}
                {categories.map((category) => {
                  const active = category.id === selected?.id;
                  return (
                    <li key={category.id} className="shrink-0">
                      <button
                        type="button"
                        aria-current={active ? "true" : undefined}
                        onClick={() => setSelectedId(category.id)}
                        className={cn(
                          "flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-[15px] whitespace-nowrap md:w-full md:justify-between md:rounded-[10px] md:border-0 md:px-3",
                          active ? "border-[#FDBA74] bg-[#FFEDD5] font-bold text-link" : "border-line bg-white text-ink md:hover:bg-bg",
                        )}
                      >
                        <span className="max-w-[200px] truncate md:max-w-none">{category.name}</span>
                        <span className={cn("text-[13px]", !active && "text-muted")}>{category.products.length}</span>
                      </button>
                    </li>
                  );
                })}
                <li className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="min-h-11 cursor-pointer rounded-full border border-dashed border-[#A8A29E] bg-transparent px-4 text-sm font-bold whitespace-nowrap text-[#44403C] md:mt-1.5 md:w-full md:rounded-[10px]"
                  >
                    + Nueva categoría
                  </button>
                </li>
              </ul>
              {creating && (
                <div className="rounded-2xl border border-line bg-white p-3 md:border-0 md:p-0 md:pt-2">
                  <CategoryNameForm
                    label="Nombre de la categoría"
                    submitLabel="Crear"
                    onCancel={() => setCreating(false)}
                    onSubmit={async (name) => {
                      const category = await createCategory.mutateAsync(name);
                      setSelectedId(category.id);
                      setCreating(false);
                    }}
                  />
                </div>
              )}
            </div>
          </nav>

          {showAll ? (
            <div className="flex min-w-0 flex-1 flex-col gap-5">
              {categories.map((category) => (
                <CategorySection key={category.id} category={category} categories={categories} />
              ))}
            </div>
          ) : selected ? (
            <CategorySection
              key={selected.id}
              category={selected}
              categories={categories}
            />
          ) : (
            <section className="min-w-0 flex-1 rounded-2xl border border-line bg-white p-6">
              <p className="m-0 text-[15px] text-muted">
                Todavía no tenés categorías. Creá la primera para empezar a cargar productos.
              </p>
            </section>
          )}
        </div>
      )}

      {/* Phones: "Nuevo producto" stays reachable at the bottom of the screen. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:px-8 md:hidden">
        {newProductButton("w-full")}
      </div>
    </div>
  );
}

function CategorySection({
  category,
  categories,
}: {
  category: CategoryWithProducts;
  categories: CategoryWithProducts[];
}) {
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rename = useRenameCategory();
  const remove = useDeleteCategory();
  const reorderCategories = useReorderCategories();
  const reorderProducts = useReorderProducts();
  const toggle = useToggleAvailability();

  const index = categories.findIndex((c) => c.id === category.id);
  const ids = categories.map((c) => c.id);
  const productIds = category.products.map((p) => p.id);

  function onDelete() {
    if (!confirmDelete(category.name)) return;
    setError(null);
    remove.mutate(category.id, {
      onError: (cause) =>
        setError(
          cause instanceof ApiError && cause.code === "CATEGORY_NOT_EMPTY"
            ? CATALOG_MESSAGES.categoryNotEmpty
            : "No pudimos eliminar la categoría. Probá de nuevo.",
        ),
    });
  }

  const onActionError = () => setError("No pudimos guardar el cambio. Probá de nuevo.");

  return (
    <section aria-label={category.name} className="flex min-w-0 flex-1 flex-col rounded-2xl border border-line bg-white">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-4 py-3 md:px-5">
        {renaming ? (
          <CategoryNameForm
            label="Nuevo nombre de la categoría"
            initialName={category.name}
            submitLabel="Guardar"
            onCancel={() => setRenaming(false)}
            onSubmit={async (name) => {
              await rename.mutateAsync({ id: category.id, name });
              setRenaming(false);
            }}
          />
        ) : (
          <>
            <h2 className="m-0 min-w-0 flex-[1_1_100%] font-display text-xl font-extrabold break-words sm:flex-1">{category.name}</h2>
            <div className="-ml-2 flex flex-wrap items-center sm:ml-0">
              <Button type="button" variant="ghost" className="min-h-11 px-3 text-sm" onClick={() => setRenaming(true)}>
                Renombrar
              </Button>
              <Button type="button" variant="ghost" className="min-h-11 px-3 text-sm text-danger" disabled={remove.isPending} onClick={onDelete}>
                Eliminar
              </Button>
              <ReorderButtons
                name={category.name}
                isFirst={index === 0}
                isLast={index === categories.length - 1}
                onMove={(direction) => {
                  setError(null);
                  reorderCategories.mutate(moveId(ids, index, direction), { onError: onActionError });
                }}
              />
            </div>
          </>
        )}
      </header>

      {error && (
        <div className="px-4 pt-3 md:px-5">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {category.products.length === 0 ? (
        <p className="m-0 px-4 py-6 text-[15px] text-muted md:px-5">Esta categoría todavía no tiene productos.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {category.products.map((product, i) => (
            <ProductRow
              key={product.id}
              product={product}
              isFirst={i === 0}
              isLast={i === category.products.length - 1}
              onMove={(direction) => {
                setError(null);
                reorderProducts.mutate(
                  { categoryId: category.id, ids: moveId(productIds, i, direction) },
                  { onError: onActionError },
                );
              }}
              onToggle={() => {
                setError(null);
                toggle.mutate({ id: product.id, available: !product.available }, { onError: onActionError });
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProductRow({
  product,
  isFirst,
  isLast,
  onMove,
  onToggle,
}: {
  product: Product;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
  onToggle: () => void;
}) {
  const price = formatArs(product.priceCents);
  return (
    <li className="flex items-center gap-2 border-b border-[#F0ECE6] py-2.5 pr-2 pl-3 last:border-b-0 sm:gap-4 sm:py-3.5 sm:pr-3 sm:pl-5">
      <Link to={`/menu/products/${product.id}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 sm:gap-4">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="size-14 shrink-0 rounded-xl bg-[#EBD9C6] object-cover" />
        ) : (
          <span aria-hidden="true" className="size-14 shrink-0 rounded-xl bg-[#EBD9C6]" />
        )}
        <span className="flex min-w-0 flex-col gap-0.5">
          <b className="truncate text-[15px]">{product.name}</b>
          <span className="text-sm font-bold sm:hidden">{price}</span>
          {product.description && <span className="hidden truncate text-[13px] text-muted sm:block">{product.description}</span>}
        </span>
      </Link>
      <b className="hidden shrink-0 text-[15px] sm:block">{price}</b>
      <div className="flex shrink-0 flex-col items-end sm:flex-row sm:items-center sm:gap-1">
        <button
          type="button"
          onClick={onToggle}
          aria-label={product.available ? `${product.name}: disponible. Marcar como agotado` : `${product.name}: agotado. Marcar como disponible`}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span
            className={cn(
              "rounded-full px-3 py-1.5 text-[13px] font-bold",
              product.available ? "bg-[#DCFCE7] text-success" : "bg-tab text-[#44403C]",
            )}
          >
            {product.available ? "Disponible" : "Agotado"}
          </span>
        </button>
        <ReorderButtons name={product.name} isFirst={isFirst} isLast={isLast} onMove={onMove} />
      </div>
    </li>
  );
}
