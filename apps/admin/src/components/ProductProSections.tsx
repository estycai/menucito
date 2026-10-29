import { describeIngredient, planLimitsFor, type Product } from "@menucito/shared";
import { IngredientsEditor } from "@/components/IngredientsEditor";
import { ProLock } from "@/components/ProLock";

/** Real-looking example shown (not editable) on plans without customizable ingredients. */
const EXAMPLE_INGREDIENT = { name: "Bacon", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 150_000 };

/**
 * The Pro sections of the product editor: "Ingredientes" (editable on Pro, locked otherwise) and
 * "Extras y variantes" (a locked placeholder on every plan). Reads the flag from the plan limits.
 */
export function ProductProSections({ product, plan }: { product: Product | null; plan: string }) {
  const canCustomize = planLimitsFor(plan).customIngredients;
  return (
    <>
      {canCustomize ? (
        product ? (
          <IngredientsEditor key={product.id} productId={product.id} saved={product.ingredients} />
        ) : (
          <section aria-labelledby="ingredients-new-heading" className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-white p-4 sm:p-6">
            <h2 id="ingredients-new-heading" className="m-0 font-display text-xl font-extrabold">
              Ingredientes
            </h2>
            <p className="m-0 text-[15px] text-muted">Guardá el producto para agregar ingredientes.</p>
          </section>
        )
      ) : (
        <ProLock
          title="Ingredientes"
          description="Cada ingrediente trae unas unidades incluidas y suma un costo por cada unidad extra que pida el cliente."
        >
          <LockedIngredients saved={product?.ingredients ?? []} />
        </ProLock>
      )}
      <ProLock
        title="Extras y variantes"
        description="Ofrecé opciones como el punto de la carne o el tamaño de las papas."
        planLocked={!canCustomize}
        comingSoon
      />
    </>
  );
}

/** Saved ingredients stay readable after a downgrade; with none saved, a static example explains the feature. */
function LockedIngredients({ saved }: { saved: Product["ingredients"] }) {
  if (saved.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="m-0 text-sm font-bold text-ink">Ingredientes guardados (solo lectura)</p>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[15px] text-ink">
          {saved.map((ingredient, index) => (
            <li key={`${index}-${ingredient.name}`} className="break-words">
              {describeIngredient(ingredient)}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div inert className="flex flex-col gap-1 rounded-xl border border-line bg-white/60 p-3">
      <span className="text-xs font-bold tracking-[.05em] text-muted">EJEMPLO</span>
      <span className="text-[15px] break-words text-ink">{describeIngredient(EXAMPLE_INGREDIENT)}</span>
    </div>
  );
}
