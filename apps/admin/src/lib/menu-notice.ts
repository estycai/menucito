import { z } from "zod";
import { ingredientSchema, type Ingredient } from "@menucito/shared";

/** Router location state the product editor sets when it leaves for the menu. */
export interface MenuLocationState {
  /** `saved`: the product was fully saved; `gone`: it no longer exists (deleted elsewhere). */
  notice?: "saved" | "gone";
}

/** Location state to pass to the menu after a fully successful product save. */
export const PRODUCT_SAVED_STATE: MenuLocationState = { notice: "saved" };

/** Location state to pass to the menu when the product being edited was deleted elsewhere. */
export const PRODUCT_GONE_STATE: MenuLocationState = { notice: "gone" };

/** The notice a location state asks the menu to show. Anything unknown is ignored. */
export function menuNotice(state: unknown): MenuLocationState["notice"] | null {
  if (typeof state !== "object" || state === null) return null;
  const { notice } = state as MenuLocationState;
  return notice === "saved" || notice === "gone" ? notice : null;
}

/**
 * Router location state of the editor after a new product was created but its photo or ingredients
 * failed. The ingredients travel along so the owner does not lose what was typed.
 */
export interface CreatedProductState {
  photoError?: boolean;
  ingredients?: Ingredient[];
}

const ingredientsSchema = z.array(ingredientSchema);

/** What a location state carries for the editor; unknown shapes (or invalid ingredients) count as nothing. */
export function createdProductState(state: unknown): { photoError: boolean; ingredients: Ingredient[] | null } {
  if (typeof state !== "object" || state === null) return { photoError: false, ingredients: null };
  const raw = state as CreatedProductState;
  const ingredients = ingredientsSchema.safeParse(raw.ingredients);
  return { photoError: raw.photoError === true, ingredients: ingredients.success ? ingredients.data : null };
}
