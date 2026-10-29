import { z } from "zod";

export const CATEGORY_NAME_MAX_LENGTH = 40;
export const PRODUCT_NAME_MAX_LENGTH = 80;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 300;
/** Highest accepted price: $999.999,99 (in cents). */
export const PRICE_MAX_CENTS = 99_999_999;
export const INGREDIENT_NAME_MAX_LENGTH = 40;
/** Highest quantity accepted for an ingredient's included, min and max. */
export const INGREDIENT_QTY_MAX = 99;
export const INGREDIENTS_MAX_PER_PRODUCT = 20;

export const CATALOG_MESSAGES = {
  categoryNameRequired: "Ingresá el nombre de la categoría",
  categoryNameTooLong: `El nombre puede tener hasta ${CATEGORY_NAME_MAX_LENGTH} caracteres`,
  categoryNameTaken: "Ya tenés una categoría con ese nombre",
  categoryNotEmpty: "Primero mové o eliminá los productos de esta categoría",
  categoryRequired: "Elegí una categoría",
  productNameRequired: "Ingresá el nombre del producto",
  productNameTooLong: `El nombre puede tener hasta ${PRODUCT_NAME_MAX_LENGTH} caracteres`,
  descriptionTooLong: `La descripción puede tener hasta ${PRODUCT_DESCRIPTION_MAX_LENGTH} caracteres`,
  priceRequired: "Ingresá el precio",
  priceInvalid: "Precio inválido. Usá el formato 9.000 o 9.000,50 (hasta $999.999,99).",
  ingredientNameRequired: "Ingresá el nombre del ingrediente",
  ingredientNameTooLong: `El nombre puede tener hasta ${INGREDIENT_NAME_MAX_LENGTH} caracteres`,
  ingredientNameTaken: "Ya hay un ingrediente con ese nombre en este producto",
  ingredientQtyInvalid: `Usá un número entero de 0 a ${INGREDIENT_QTY_MAX}`,
  ingredientMaxTooLow: "El máximo debe ser al menos 1",
  ingredientMinAboveIncluded: "El mínimo no puede ser mayor que lo incluido",
  ingredientIncludedAboveMax: "Lo incluido no puede ser mayor que el máximo",
  ingredientExtraPriceInvalid: "Precio inválido. Usá $0 o más, con el formato 1.500 o 1.500,50.",
  ingredientsTooMany: `Podés cargar hasta ${INGREDIENTS_MAX_PER_PRODUCT} ingredientes por producto`,
} as const;

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, CATALOG_MESSAGES.categoryNameRequired)
  .max(CATEGORY_NAME_MAX_LENGTH, CATALOG_MESSAGES.categoryNameTooLong);

/** Body of `POST /api/categories` and `PATCH /api/categories/:id`. */
export const categoryInputSchema = z.object({ name: categoryNameSchema });

export type CategoryInput = z.infer<typeof categoryInputSchema>;

const productFields = {
  categoryId: z.string().min(1, CATALOG_MESSAGES.categoryRequired),
  name: z
    .string()
    .trim()
    .min(1, CATALOG_MESSAGES.productNameRequired)
    .max(PRODUCT_NAME_MAX_LENGTH, CATALOG_MESSAGES.productNameTooLong),
  description: z.string().trim().max(PRODUCT_DESCRIPTION_MAX_LENGTH, CATALOG_MESSAGES.descriptionTooLong),
  priceCents: z
    .number()
    .int(CATALOG_MESSAGES.priceInvalid)
    .min(0, CATALOG_MESSAGES.priceInvalid)
    .max(PRICE_MAX_CENTS, CATALOG_MESSAGES.priceInvalid),
  available: z.boolean(),
};

/** Body of `POST /api/products`. */
export const createProductSchema = z.object({
  ...productFields,
  description: productFields.description.default(""),
  available: productFields.available.default(true),
});

/** Body of `PATCH /api/products/:id`: any subset of the create fields. */
export const updateProductSchema = z.object({
  categoryId: productFields.categoryId.optional(),
  name: productFields.name.optional(),
  description: productFields.description.optional(),
  priceCents: productFields.priceCents.optional(),
  available: productFields.available.optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

/** Body of the reorder endpoints: the full ordered list of ids, each exactly once. */
export const reorderSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, "ids must be unique"),
});

export type ReorderInput = z.infer<typeof reorderSchema>;

const ingredientQty = z
  .number(CATALOG_MESSAGES.ingredientQtyInvalid)
  .int(CATALOG_MESSAGES.ingredientQtyInvalid)
  .min(0, CATALOG_MESSAGES.ingredientQtyInvalid)
  .max(INGREDIENT_QTY_MAX, CATALOG_MESSAGES.ingredientQtyInvalid);

/**
 * A customizable ingredient of a product. `extraPriceCents` is charged for each unit above
 * `includedQty`. The position in the product's list is the position in the array.
 * Cross-field rules run only when every field is valid on its own.
 */
export const ingredientSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, CATALOG_MESSAGES.ingredientNameRequired)
      .max(INGREDIENT_NAME_MAX_LENGTH, CATALOG_MESSAGES.ingredientNameTooLong),
    includedQty: ingredientQty,
    minQty: ingredientQty,
    maxQty: ingredientQty,
    extraPriceCents: z
      .number(CATALOG_MESSAGES.ingredientExtraPriceInvalid)
      .int(CATALOG_MESSAGES.ingredientExtraPriceInvalid)
      .min(0, CATALOG_MESSAGES.ingredientExtraPriceInvalid)
      .max(PRICE_MAX_CENTS, CATALOG_MESSAGES.ingredientExtraPriceInvalid),
  })
  .refine((value) => value.maxQty >= 1, { message: CATALOG_MESSAGES.ingredientMaxTooLow, path: ["maxQty"] })
  .refine((value) => value.minQty <= value.includedQty, {
    message: CATALOG_MESSAGES.ingredientMinAboveIncluded,
    path: ["minQty"],
  })
  .refine((value) => value.includedQty <= value.maxQty, {
    message: CATALOG_MESSAGES.ingredientIncludedAboveMax,
    path: ["includedQty"],
  });

export type Ingredient = z.infer<typeof ingredientSchema>;

/** Lowercase key used to detect duplicated ingredient names inside a product. */
export const ingredientNameKey = (name: string) => name.trim().toLowerCase();

/**
 * Body of `PUT /api/products/:id/ingredients`: the whole ordered list (it replaces the saved one).
 * Names must be unique inside the list ignoring case; the error points at the repeated item.
 */
export const replaceIngredientsSchema = z
  .object({
    ingredients: z.array(ingredientSchema).max(INGREDIENTS_MAX_PER_PRODUCT, CATALOG_MESSAGES.ingredientsTooMany),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.ingredients.forEach((ingredient, index) => {
      const key = ingredientNameKey(ingredient.name);
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: CATALOG_MESSAGES.ingredientNameTaken,
          path: ["ingredients", index, "name"],
        });
      }
      seen.add(key);
    });
  });

export type ReplaceIngredientsInput = z.infer<typeof replaceIngredientsSchema>;

/** Response of `PUT /api/products/:id/ingredients`: the saved list, in order. */
export interface ReplaceIngredientsResult {
  ingredients: Ingredient[];
}

/** One-line summary: `Bacon · incluye 1 · mín 0 · máx 3 · +$1.500 c/u extra`. */
export function describeIngredient(ingredient: Ingredient): string {
  const extra =
    ingredient.extraPriceCents > 0 ? `+${formatArs(ingredient.extraPriceCents)} c/u extra` : "sin costo extra";
  return `${ingredient.name} · incluye ${ingredient.includedQty} · mín ${ingredient.minQty} · máx ${ingredient.maxQty} · ${extra}`;
}

/** Product as returned by the API (dates as ISO strings). */
export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  /** Price in ARS cents (integer). */
  priceCents: number;
  /** Public path of the photo (served by `GET /api/media/*`), or `null`. */
  imageUrl: string | null;
  /** `false` means "Agotado" (sold out). */
  available: boolean;
  /** Customizable ingredients in display order (empty when none; readable on every plan). */
  ingredients: Ingredient[];
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  position: number;
}

export interface CategoryWithProducts extends Category {
  products: Product[];
}

export interface CatalogUsage {
  /** Products the restaurant has now. */
  products: number;
  /** Plan limit, or `null` when unlimited. */
  maxProducts: number | null;
  productPhotos: boolean;
}

/** Response of `GET /api/categories`. */
export interface Catalog {
  categories: CategoryWithProducts[];
  usage: CatalogUsage;
}

const PRICE_PATTERN = /^(\d+|\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/;

/**
 * Reads an Argentine price as typed by a person and returns it in cents, or `null` when it is not
 * a valid price. Accepts `$` and spaces anywhere, `.` as thousands separator (in groups of three)
 * and `,` with up to 2 decimals: `9.000`, `9000`, `9.000,50` and `$ 9.000` are all valid.
 * Negative values and anything above $999.999,99 return `null`.
 */
export function parseArsPrice(input: string): number | null {
  const compact = input.replace(/[$\s]/g, "");
  const match = PRICE_PATTERN.exec(compact);
  if (!match?.[1]) return null;
  const integer = match[1].replace(/\./g, "");
  // Longer strings would lose precision as numbers, and are over the limit anyway.
  if (integer.length > 9) return null;
  const cents = Number(integer) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents <= PRICE_MAX_CENTS ? cents : null;
}

/** Formats cents as an Argentine price: `900000` -> `$9.000`, `900050` -> `$9.000,50`. */
export function formatArs(cents: number): string {
  const integer = Math.floor(cents / 100);
  const decimals = cents % 100;
  const grouped = String(integer).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimals ? `$${grouped},${String(decimals).padStart(2, "0")}` : `$${grouped}`;
}
