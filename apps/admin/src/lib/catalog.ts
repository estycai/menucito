import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type {
  Catalog,
  Category,
  CreateProductInput,
  Product,
  ProductPhotoUploadResult,
  UpdateProductInput,
} from "@menucito/shared";
import { api } from "./restaurant";
import { useSession } from "./session";

export const CATALOG_KEY = ["catalog"] as const;

/** Catalog query key of the logged-in user; product queries live under it so one invalidation refreshes all. */
function useCatalogKey(): QueryKey {
  const { data: session } = useSession();
  return [...CATALOG_KEY, session?.user.id];
}

/** Every category with its products, plus the plan usage. */
export function useCatalog() {
  const queryKey = useCatalogKey();
  return useQuery({
    queryKey,
    enabled: Boolean(queryKey[1]),
    queryFn: () => api<Catalog>("/api/categories"),
  });
}

/** One product, for the editor. */
export function useProduct(id: string | undefined) {
  const catalogKey = useCatalogKey();
  return useQuery({
    queryKey: [...catalogKey, "product", id],
    enabled: Boolean(catalogKey[1] && id),
    queryFn: () => api<Product>(`/api/products/${id}`),
  });
}

/** Mutation that refreshes the catalog (and every product under it) when it settles. */
function useCatalogMutation<TVariables, TResult>(mutationFn: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: CATALOG_KEY }),
  });
}

const jsonBody = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export function useCreateCategory() {
  return useCatalogMutation((name: string) => api<Category>("/api/categories", jsonBody("POST", { name })));
}

export function useRenameCategory() {
  return useCatalogMutation(({ id, name }: { id: string; name: string }) =>
    api<Category>(`/api/categories/${id}`, jsonBody("PATCH", { name })),
  );
}

export function useDeleteCategory() {
  return useCatalogMutation((id: string) => api<void>(`/api/categories/${id}`, { method: "DELETE" }));
}

export function useCreateProduct() {
  return useCatalogMutation((input: CreateProductInput) => api<Product>("/api/products", jsonBody("POST", input)));
}

export function useUpdateProduct() {
  return useCatalogMutation(({ id, ...input }: UpdateProductInput & { id: string }) =>
    api<Product>(`/api/products/${id}`, jsonBody("PATCH", input)),
  );
}

export function useDeleteProduct() {
  return useCatalogMutation((id: string) => api<void>(`/api/products/${id}`, { method: "DELETE" }));
}

/** Uploads an already normalized WebP photo (see `normalizeProductPhoto`). */
export function useUploadProductPhoto() {
  return useCatalogMutation(({ id, webp }: { id: string; webp: Blob }) => {
    const form = new FormData();
    form.append("file", webp, "photo.webp");
    return api<ProductPhotoUploadResult>(`/api/products/${id}/photo`, { method: "PUT", body: form });
  });
}

export function useRemoveProductPhoto() {
  return useCatalogMutation((id: string) => api<void>(`/api/products/${id}/photo`, { method: "DELETE" }));
}

/**
 * Mutation that sends a new order and applies it to the cached catalog right away (optimistic),
 * rolling back if the request fails.
 */
function useOptimisticCatalogMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<void>,
  apply: (catalog: Catalog, variables: TVariables) => Catalog,
) {
  const queryClient = useQueryClient();
  const queryKey = useCatalogKey();
  return useMutation({
    mutationFn,
    onMutate: async (variables: TVariables) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Catalog>(queryKey);
      if (previous) queryClient.setQueryData(queryKey, apply(previous, variables));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CATALOG_KEY }),
  });
}

/** `items` sorted as `ids`, with `position` rewritten to match. */
function sortByIds<T extends { id: string; position: number }>(items: T[], ids: readonly string[]): T[] {
  const index = new Map(ids.map((id, position) => [id, position]));
  return items
    .map((item) => ({ ...item, position: index.get(item.id) ?? item.position }))
    .sort((a, b) => a.position - b.position);
}

export function useReorderCategories() {
  return useOptimisticCatalogMutation(
    (ids: string[]) => api<void>("/api/categories/order", jsonBody("PUT", { ids })),
    (catalog, ids) => ({ ...catalog, categories: sortByIds(catalog.categories, ids) }),
  );
}

export function useReorderProducts() {
  return useOptimisticCatalogMutation(
    ({ categoryId, ids }: { categoryId: string; ids: string[] }) =>
      api<void>(`/api/categories/${categoryId}/products/order`, jsonBody("PUT", { ids })),
    (catalog, { categoryId, ids }) => ({
      ...catalog,
      categories: catalog.categories.map((category) =>
        category.id === categoryId ? { ...category, products: sortByIds(category.products, ids) } : category,
      ),
    }),
  );
}

/** Toggles "Disponible"/"Agotado" from the list, updating the cached catalog right away. */
export function useToggleAvailability() {
  return useOptimisticCatalogMutation(
    async ({ id, available }: { id: string; available: boolean }) => {
      await api<Product>(`/api/products/${id}`, jsonBody("PATCH", { available }));
    },
    (catalog, { id, available }) => ({
      ...catalog,
      categories: catalog.categories.map((category) => ({
        ...category,
        products: category.products.map((product) => (product.id === id ? { ...product, available } : product)),
      })),
    }),
  );
}
