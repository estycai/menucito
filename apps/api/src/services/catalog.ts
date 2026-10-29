import {
  MEDIA_CONTENT_TYPE,
  PRODUCT_PHOTO_MAX_BYTES,
  planLimitsFor,
  type Catalog,
  type Category,
  type CreateProductInput,
  type PlanLimits,
  type Product,
  type ProductPhotoUploadResult,
  type UpdateProductInput,
} from "@menucito/shared";
import type { CategoryRow, ProductRow } from "../db/schema";
import { CATEGORY_NAME_UNIQUE_INDEX, createCategoriesRepository, type CategoriesRepository } from "../repositories/categories";
import { ForeignKeyViolationError, UniqueViolationError } from "../repositories/errors";
import { createProductsRepository, type ProductChanges, type ProductsRepository } from "../repositories/products";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import { createMediaStorage, publicPathFor, type MediaStorage } from "../storage/media";
import { DomainError, RestaurantNotFoundError, ValidationError } from "./errors";
import { assertWebpUpload, deleteMediaQuietly, type ImageUpload } from "./uploads";

export class CategoryNotFoundError extends DomainError {
  readonly code = "CATEGORY_NOT_FOUND";
  constructor() {
    super("Category not found");
  }
}

export class ProductNotFoundError extends DomainError {
  readonly code = "PRODUCT_NOT_FOUND";
  constructor() {
    super("Product not found");
  }
}

export class CategoryNameTakenError extends DomainError {
  readonly code = "CATEGORY_NAME_TAKEN";
  constructor() {
    super("You already have a category with that name");
  }
}

export class CategoryNotEmptyError extends DomainError {
  readonly code = "CATEGORY_NOT_EMPTY";
  constructor() {
    super("Move or delete the products of this category first");
  }
}

export class PlanLimitError extends DomainError {
  readonly code = "PLAN_LIMIT";
}

function toCategory(row: CategoryRow): Category {
  return { id: row.id, name: row.name, position: row.position };
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    imageUrl: row.imageUrl,
    available: row.available,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const nextPosition = (max: number | null) => (max ?? -1) + 1;

/** The category was deleted between the check and the write. */
function translateMissingCategory(error: unknown): never {
  throw error instanceof ForeignKeyViolationError ? new CategoryNotFoundError() : error;
}

/** `ids` must be exactly the current set (same ids, each once); otherwise nothing is reordered. */
function assertSameSet(ids: readonly string[], current: readonly { id: string }[]) {
  const known = new Set(current.map((row) => row.id));
  if (ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
    throw new ValidationError("ids: must list every current id exactly once");
  }
}

export interface CatalogDependencies {
  restaurants: RestaurantsRepository;
  categories: CategoriesRepository;
  products: ProductsRepository;
  storage: MediaStorage;
  /** Plan limits lookup; injectable so tests can simulate other plans. */
  limitsFor?: (plan: string) => PlanLimits;
}

/**
 * Menu catalog of the owner's restaurant: categories, products, plan limits and product photos.
 * The tenant is always the restaurant owned by `ownerId` (from the session); every repository call
 * is scoped by its id, so a foreign or unknown id is a 404, never a 403.
 */
export function createCatalogService({
  restaurants,
  categories,
  products,
  storage,
  limitsFor = planLimitsFor,
}: CatalogDependencies) {
  const deleteQuietly = (imageUrl: string | null) => deleteMediaQuietly(storage, imageUrl, "catalog");

  async function restaurantOf(ownerId: string) {
    const restaurant = await restaurants.findByOwner(ownerId);
    if (!restaurant) throw new RestaurantNotFoundError();
    return restaurant;
  }

  async function categoryOf(restaurantId: string, id: string) {
    const category = await categories.find(restaurantId, id);
    if (!category) throw new CategoryNotFoundError();
    return category;
  }

  async function productOf(restaurantId: string, id: string) {
    const product = await products.find(restaurantId, id);
    if (!product) throw new ProductNotFoundError();
    return product;
  }

  function translateNameTaken(error: unknown): never {
    if (error instanceof UniqueViolationError && error.column === CATEGORY_NAME_UNIQUE_INDEX) {
      throw new CategoryNameTakenError();
    }
    throw error;
  }

  return {
    /** Every category with its products (both ordered by position) and the plan usage. */
    async getCatalog(ownerId: string): Promise<Catalog> {
      const restaurant = await restaurantOf(ownerId);
      const [categoryRows, productRows] = await Promise.all([
        categories.list(restaurant.id),
        products.list(restaurant.id),
      ]);
      const byCategory = new Map<string, Product[]>(categoryRows.map((row) => [row.id, []]));
      for (const row of productRows) byCategory.get(row.categoryId)?.push(toProduct(row));

      const limits = limitsFor(restaurant.plan);
      return {
        categories: categoryRows.map((row) => ({ ...toCategory(row), products: byCategory.get(row.id) ?? [] })),
        usage: { products: productRows.length, maxProducts: limits.maxProducts, productPhotos: limits.productPhotos },
      };
    },

    /** Creates a category at the end of the list. `name` must already be validated (trimmed). */
    async createCategory(ownerId: string, name: string): Promise<Category> {
      const restaurant = await restaurantOf(ownerId);
      const now = new Date();
      const row = await categories
        .insert({
          id: crypto.randomUUID(),
          restaurantId: restaurant.id,
          name,
          position: nextPosition(await categories.maxPosition(restaurant.id)),
          createdAt: now,
          updatedAt: now,
        })
        .catch(translateNameTaken);
      return toCategory(row);
    },

    async renameCategory(ownerId: string, id: string, name: string): Promise<Category> {
      const restaurant = await restaurantOf(ownerId);
      const row = await categories.rename(restaurant.id, id, name, new Date()).catch(translateNameTaken);
      if (!row) throw new CategoryNotFoundError();
      return toCategory(row);
    },

    /**
     * Deletes an empty category. A category with products is never deleted (409): cascading would
     * silently destroy many products and their photos with one click.
     */
    async deleteCategory(ownerId: string, id: string): Promise<void> {
      const restaurant = await restaurantOf(ownerId);
      await categoryOf(restaurant.id, id);
      if ((await products.countByCategory(restaurant.id, id)) > 0) throw new CategoryNotEmptyError();
      try {
        // `on delete restrict` also covers a product created between the count and the delete.
        if (!(await categories.delete(restaurant.id, id))) throw new CategoryNotFoundError();
      } catch (error) {
        if (error instanceof ForeignKeyViolationError) throw new CategoryNotEmptyError();
        throw error;
      }
    },

    /** Rewrites the category order. `ids` must be exactly the restaurant's categories. */
    async reorderCategories(ownerId: string, ids: readonly string[]): Promise<void> {
      const restaurant = await restaurantOf(ownerId);
      assertSameSet(ids, await categories.list(restaurant.id));
      await categories.reorder(restaurant.id, ids, new Date());
    },

    /** Rewrites the product order of a category. `ids` must be exactly its products. */
    async reorderProducts(ownerId: string, categoryId: string, ids: readonly string[]): Promise<void> {
      const restaurant = await restaurantOf(ownerId);
      await categoryOf(restaurant.id, categoryId);
      assertSameSet(ids, await products.listByCategory(restaurant.id, categoryId));
      await products.reorder(restaurant.id, categoryId, ids, new Date());
    },

    async getProduct(ownerId: string, id: string): Promise<Product> {
      const restaurant = await restaurantOf(ownerId);
      return toProduct(await productOf(restaurant.id, id));
    },

    /**
     * Creates a product at the end of its category. Only creation is limited by the plan: a
     * restaurant above the limit (e.g. after a downgrade) keeps, edits and deletes its products.
     * Known gap: the limit is checked with a count before the insert, so two concurrent creates
     * can exceed it by one. Acceptable for a soft commercial limit.
     */
    async createProduct(ownerId: string, input: CreateProductInput): Promise<Product> {
      const restaurant = await restaurantOf(ownerId);
      await categoryOf(restaurant.id, input.categoryId);

      const { maxProducts } = limitsFor(restaurant.plan);
      if (maxProducts !== null && (await products.count(restaurant.id)) >= maxProducts) {
        throw new PlanLimitError(`Your plan allows up to ${maxProducts} products`);
      }

      const now = new Date();
      const row = await products.insert({
        id: crypto.randomUUID(),
        restaurantId: restaurant.id,
        categoryId: input.categoryId,
        name: input.name,
        description: input.description,
        priceCents: input.priceCents,
        available: input.available,
        position: nextPosition(await products.maxPosition(restaurant.id, input.categoryId)),
        createdAt: now,
        updatedAt: now,
      }).catch(translateMissingCategory);
      return toProduct(row);
    },

    /** Partial update. Changing the category moves the product to the end of the new one. */
    async updateProduct(ownerId: string, id: string, input: UpdateProductInput): Promise<Product> {
      const restaurant = await restaurantOf(ownerId);
      const current = await productOf(restaurant.id, id);

      const changes: ProductChanges = { ...input };
      if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
        await categoryOf(restaurant.id, input.categoryId);
        changes.position = nextPosition(await products.maxPosition(restaurant.id, input.categoryId));
      }

      const row = await products.update(restaurant.id, id, changes, new Date()).catch(translateMissingCategory);
      if (!row) throw new ProductNotFoundError();
      return toProduct(row);
    },

    /** Deletes the product, then its photo (best effort). */
    async deleteProduct(ownerId: string, id: string): Promise<void> {
      const restaurant = await restaurantOf(ownerId);
      const deleted = await products.delete(restaurant.id, id);
      if (!deleted) throw new ProductNotFoundError();
      await deleteQuietly(deleted.imageUrl);
    },

    /**
     * Stores a new product photo and replaces the previous one. Same order as the logo: write the
     * new object, point the product at it, then delete the old object (logged, not raised).
     */
    async uploadProductPhoto(ownerId: string, id: string, upload: ImageUpload): Promise<ProductPhotoUploadResult> {
      assertWebpUpload(upload, "photo", PRODUCT_PHOTO_MAX_BYTES);
      const restaurant = await restaurantOf(ownerId);
      const product = await productOf(restaurant.id, id);
      if (!limitsFor(restaurant.plan).productPhotos) {
        throw new PlanLimitError("Product photos are not included in your plan");
      }

      // Random name per upload, so cached copies of an older photo never go stale.
      const key = `products/${restaurant.id}/${crypto.randomUUID()}.webp`;
      const imageUrl = publicPathFor(key);
      await storage.put(key, upload.bytes, MEDIA_CONTENT_TYPE);

      let updated: ProductRow | null;
      try {
        updated = await products.updateImageUrl(restaurant.id, id, imageUrl, new Date());
      } catch (error) {
        await deleteQuietly(imageUrl);
        throw error;
      }
      if (!updated) {
        // Deleted while uploading.
        await deleteQuietly(imageUrl);
        throw new ProductNotFoundError();
      }

      await deleteQuietly(product.imageUrl);
      return { imageUrl };
    },

    /** Removes the photo (no-op when there is none; allowed on every plan). */
    async removeProductPhoto(ownerId: string, id: string): Promise<void> {
      const restaurant = await restaurantOf(ownerId);
      const product = await productOf(restaurant.id, id);
      if (!product.imageUrl) return;
      await products.updateImageUrl(restaurant.id, id, null, new Date());
      await deleteQuietly(product.imageUrl);
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;

/** Wires the service with D1 and the R2 media bucket. */
export function catalogServiceFor(db: D1Database, bucket: R2Bucket): CatalogService {
  return createCatalogService({
    restaurants: createRestaurantsRepository(db),
    categories: createCategoriesRepository(db),
    products: createProductsRepository(db),
    storage: createMediaStorage(bucket),
  });
}
