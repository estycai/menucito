import { useEffect, useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CATALOG_MESSAGES,
  INGREDIENTS_MAX_PER_PRODUCT,
  describeIngredient,
  ingredientNameKey,
  ingredientSchema,
  type Ingredient,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { FormField } from "@/components/FormField";
import { ReorderButtons } from "@/components/ReorderButtons";
import { Button } from "@/components/ui/button";
import { useReplaceIngredients } from "@/lib/catalog";
import {
  NEW_INGREDIENT_VALUES,
  formValuesOf,
  ingredientFormSchema,
  sameIngredients,
  toIngredient,
  type IngredientFormValues,
} from "@/lib/ingredient-form";
import { moveId } from "@/lib/order";
import { ApiError } from "@/lib/restaurant";

/** A draft row; `key` is only for React, it is not sent to the API. */
interface DraftIngredient extends Ingredient {
  key: string;
}

const withKey = (ingredient: Ingredient): DraftIngredient => ({ ...ingredient, key: crypto.randomUUID() });
const withoutKey = (item: DraftIngredient): Ingredient => ({
  name: item.name,
  includedQty: item.includedQty,
  minQty: item.minQty,
  maxQty: item.maxQty,
  extraPriceCents: item.extraPriceCents,
});

/** `null` when the form is closed, `"new"` when adding, otherwise the `key` of the row being edited. */
type FormTarget = string | null;

/**
 * "Ingredientes" of a saved product on a plan with customizable ingredients. The list is edited
 * locally (add, edit, remove, reorder) and saved as a whole with "Guardar ingredientes", which
 * replaces the product's list in one request.
 */
export function IngredientsEditor({ productId, saved }: { productId: string; saved: Ingredient[] }) {
  const replace = useReplaceIngredients();
  const [draft, setDraft] = useState<DraftIngredient[]>(() => saved.map(withKey));
  const [baseline, setBaseline] = useState<Ingredient[]>(saved);
  const [formTarget, setFormTarget] = useState<FormTarget>(null);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const headingId = useId();

  const dirty = !sameIngredients(draft.map(withoutKey), baseline);
  const atCapacity = draft.length >= INGREDIENTS_MAX_PER_PRODUCT;
  const editing = formTarget && formTarget !== "new" ? draft.find((item) => item.key === formTarget) : undefined;

  function change(next: DraftIngredient[]) {
    setStatus(null);
    setDraft(next);
  }

  function onSubmitForm(ingredient: Ingredient) {
    if (formTarget === "new") change([...draft, withKey(ingredient)]);
    else change(draft.map((item) => (item.key === formTarget ? { ...ingredient, key: item.key } : item)));
    setFormTarget(null);
  }

  function onRemove(item: DraftIngredient) {
    if (!window.confirm(`¿Quitar «${item.name}» de los ingredientes?`)) return;
    if (formTarget === item.key) setFormTarget(null);
    change(draft.filter((other) => other.key !== item.key));
  }

  function onMove(index: number, direction: -1 | 1) {
    const order = moveId(
      draft.map((item) => item.key),
      index,
      direction,
    );
    change(order.map((key) => draft.find((item) => item.key === key) as DraftIngredient));
  }

  async function onSave() {
    setStatus(null);
    const ingredients = draft.map(withoutKey);
    try {
      const result = await replace.mutateAsync({ id: productId, ingredients });
      setBaseline(result.ingredients);
      setStatus("saved");
    } catch (cause) {
      setErrorMessage(
        cause instanceof ApiError && cause.code === "PLAN_FEATURE"
          ? "Tu plan actual no incluye ingredientes personalizables."
          : "No pudimos guardar los ingredientes. Probá de nuevo.",
      );
      setStatus("error");
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-white p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="m-0 font-display text-xl font-extrabold">
          Ingredientes
        </h2>
        <p className="m-0 text-[15px] text-muted">
          Definí cuántas unidades trae el producto y cuánto cuesta cada unidad extra. Los cambios se aplican al tocar «Guardar ingredientes».
        </p>
      </div>

      {draft.length === 0 ? (
        <p className="m-0 text-[15px] text-muted">Todavía no cargaste ingredientes.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {draft.map((item, index) => (
            <li
              key={item.key}
              className="flex flex-col gap-1 border-b border-[#F0ECE6] py-3 first:pt-0 last:border-b-0 sm:flex-row sm:items-center sm:gap-3"
            >
              <span className="min-w-0 flex-1 text-[15px] break-words">{describeIngredient(withoutKey(item))}</span>
              <div className="-ml-2 flex flex-wrap items-center sm:ml-0">
                <Button type="button" variant="ghost" className="min-h-11 px-3 text-sm" aria-label={`Editar ${item.name}`} onClick={() => setFormTarget(item.key)}>
                  Editar
                </Button>
                <Button type="button" variant="ghost" className="min-h-11 px-3 text-sm text-danger" aria-label={`Quitar ${item.name}`} onClick={() => onRemove(item)}>
                  Quitar
                </Button>
                <ReorderButtons
                  name={item.name}
                  isFirst={index === 0}
                  isLast={index === draft.length - 1}
                  onMove={(direction) => onMove(index, direction)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {formTarget ? (
        <IngredientForm
          // Remount with fresh values when switching between rows.
          key={formTarget}
          initial={editing ? formValuesOf(withoutKey(editing)) : NEW_INGREDIENT_VALUES}
          submitLabel={editing ? "Guardar cambios" : "Agregar"}
          takenNames={new Set(draft.filter((item) => item.key !== formTarget).map((item) => ingredientNameKey(item.name)))}
          onSubmit={onSubmitForm}
          onCancel={() => setFormTarget(null)}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          <Button type="button" variant="outline" className="min-h-12 self-start" disabled={atCapacity} onClick={() => setFormTarget("new")}>
            Agregar ingrediente
          </Button>
          {atCapacity && <p className="m-0 text-[13px] text-muted">{CATALOG_MESSAGES.ingredientsTooMany}</p>}
        </div>
      )}

      {status === "error" && <Notice tone="error">{errorMessage}</Notice>}
      <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className="m-0 text-sm text-muted">
          {status === "saved" && !dirty ? "Ingredientes guardados." : dirty ? "Tenés cambios sin guardar." : ""}
        </p>
        <Button type="button" className="min-h-12 w-full rounded-xl px-[26px] text-[15px] sm:w-auto" disabled={!dirty || replace.isPending} onClick={onSave}>
          Guardar ingredientes
        </Button>
      </div>
    </section>
  );
}

function IngredientForm({
  initial,
  submitLabel,
  takenNames,
  onSubmit,
  onCancel,
}: {
  initial: IngredientFormValues;
  submitLabel: string;
  takenNames: ReadonlySet<string>;
  onSubmit: (ingredient: Ingredient) => void;
  onCancel: () => void;
}) {
  const schema = useMemo(() => ingredientFormSchema(takenNames), [takenNames]);
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<IngredientFormValues>({ resolver: zodResolver(schema), defaultValues: initial });

  useEffect(() => setFocus("name"), [setFocus]);

  return (
    <form
      noValidate
      aria-label={submitLabel === "Agregar" ? "Nuevo ingrediente" : "Editar ingrediente"}
      onSubmit={handleSubmit((values) => onSubmit(ingredientSchema.parse(toIngredient(values))))}
      className="flex flex-col gap-4 rounded-xl border border-line bg-bg p-4"
    >
      <FormField label="Nombre" autoComplete="off" error={errors.name?.message} {...register("name")} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField label="Incluidas" inputMode="numeric" autoComplete="off" error={errors.includedQty?.message} {...register("includedQty")} />
        <FormField label="Mínimo" inputMode="numeric" autoComplete="off" error={errors.minQty?.message} {...register("minQty")} />
        <FormField label="Máximo" inputMode="numeric" autoComplete="off" error={errors.maxQty?.message} {...register("maxQty")} />
      </div>
      <FormField
        label="Precio extra por unidad"
        inputMode="decimal"
        autoComplete="off"
        placeholder="$ 1.500"
        hint="Se cobra por cada unidad por encima de las incluidas. 0 si no tiene costo."
        error={errors.extraPrice?.message}
        {...register("extraPrice")}
      />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="px-[22px]" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" className="min-h-12 rounded-xl px-[26px] text-[15px]">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
