import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CustomerDetail,
  CustomerHeatmapPoint,
  CustomerImportRequest,
  CustomerImportResult,
  CustomerList,
  CustomerOrdersPage,
  CustomersHeatmap,
  CustomerSortDir,
  CustomerSortField,
  CustomerTag,
  CustomerTagColor,
  UpdateCustomerInput,
} from "@menucito/shared";
import { localDateKey } from "@menucito/shared";
import { ApiError, api } from "./restaurant";

export const CUSTOMERS_KEY = ["customers"] as const;
export const CUSTOMER_TAGS_KEY = ["customer-tags"] as const;
export const CUSTOMER_DETAIL_KEY = (id: string) => [...CUSTOMERS_KEY, "detail", id] as const;

/** Query names of the Clientes URL (Spanish, like the rest of the admin). */
export const CUSTOMER_PARAMS = {
  q: "q",
  from: "desde",
  to: "hasta",
  product: "compro",
  tag: "etiqueta",
  sort: "orden",
  dir: "dir",
  page: "pagina",
} as const;

export interface CustomerFilters {
  q?: string;
  from?: string;
  to?: string;
  product?: string;
  tag?: string;
  sort: CustomerSortField;
  dir: CustomerSortDir;
  page: number;
}

export const DEFAULT_CUSTOMER_FILTERS: CustomerFilters = { sort: "orders", dir: "desc", page: 1 };

const text = (search: URLSearchParams, name: string): string | undefined => search.get(name)?.trim() || undefined;

/** Reads the list filters of the URL, ignoring unknown sort values and a page under 1. */
export function customerFiltersFromSearch(search: URLSearchParams): CustomerFilters {
  const sort = text(search, CUSTOMER_PARAMS.sort);
  const dir = text(search, CUSTOMER_PARAMS.dir);
  const page = Number(text(search, CUSTOMER_PARAMS.page) ?? "1");
  return {
    ...DEFAULT_CUSTOMER_FILTERS,
    q: text(search, CUSTOMER_PARAMS.q),
    from: text(search, CUSTOMER_PARAMS.from),
    to: text(search, CUSTOMER_PARAMS.to),
    product: text(search, CUSTOMER_PARAMS.product),
    tag: text(search, CUSTOMER_PARAMS.tag),
    ...(sort === "orders" || sort === "spent" || sort === "last" || sort === "name" || sort === "since"
      ? { sort }
      : {}),
    ...(dir === "asc" || dir === "desc" ? { dir } : {}),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Writes the filters over `search`, dropping the defaults so the URL stays short. */
export function searchWithCustomerFilters(search: URLSearchParams, filters: CustomerFilters): URLSearchParams {
  const next = new URLSearchParams(search);
  const set = (param: string, value: string | undefined) => (value ? next.set(param, value) : next.delete(param));
  set(CUSTOMER_PARAMS.q, filters.q?.trim());
  set(CUSTOMER_PARAMS.from, filters.from);
  set(CUSTOMER_PARAMS.to, filters.to);
  set(CUSTOMER_PARAMS.product, filters.product);
  set(CUSTOMER_PARAMS.tag, filters.tag);
  set(CUSTOMER_PARAMS.sort, filters.sort === DEFAULT_CUSTOMER_FILTERS.sort ? undefined : filters.sort);
  set(CUSTOMER_PARAMS.dir, filters.dir === DEFAULT_CUSTOMER_FILTERS.dir ? undefined : filters.dir);
  set(CUSTOMER_PARAMS.page, filters.page > 1 ? String(filters.page) : undefined);
  return next;
}

/** How many filters besides the search and the order are set, for the "Filtros (n)" button. */
export function activeCustomerFilterCount(filters: CustomerFilters): number {
  return [filters.from, filters.to, filters.product, filters.tag].filter(Boolean).length;
}

/** The API query string of a page (the page is used by the list, not the CSV). The API uses English names. */
export function customerQueryString(filters: CustomerFilters, withPage = true): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.product) params.set("product", filters.product);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.sort !== DEFAULT_CUSTOMER_FILTERS.sort) params.set("sort", filters.sort);
  if (filters.dir !== DEFAULT_CUSTOMER_FILTERS.dir) params.set("dir", filters.dir);
  if (withPage && filters.page > 1) params.set("page", String(filters.page));
  return params.toString();
}

export function useCustomers(filters: CustomerFilters, enabled = true) {
  const qs = customerQueryString(filters);
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, "list", filters],
    queryFn: () => api<CustomerList>(`/api/customers${qs ? `?${qs}` : ""}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCustomer(id: string | null) {
  return useQuery({
    queryKey: CUSTOMER_DETAIL_KEY(id ?? ""),
    queryFn: () => api<CustomerDetail>(`/api/customers/${id}`),
    enabled: Boolean(id),
  });
}

export function useCustomerOrders(id: string | null, page: number) {
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, "orders", id, page],
    queryFn: () => api<CustomerOrdersPage>(`/api/customers/${id}/orders?page=${page}`),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
}

export function useCustomerTags(enabled = true) {
  return useQuery({
    queryKey: CUSTOMER_TAGS_KEY,
    queryFn: () => api<CustomerTag[]>("/api/customer-tags"),
    enabled,
  });
}

export function useCustomerHeatmap(filters: CustomerFilters, enabled = true) {
  const qs = customerQueryString(filters, false);
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, "heatmap", filters],
    queryFn: () => api<CustomersHeatmap>(`/api/customers/heatmap${qs ? `?${qs}` : ""}`),
    enabled,
  });
}

/** Invalidates every customer list, the sheet and the heatmap after a change. */
function useInvalidateCustomers() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY });
    void queryClient.invalidateQueries({ queryKey: CUSTOMER_TAGS_KEY });
  };
}

export function useUpdateCustomer() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & UpdateCustomerInput) =>
      api<CustomerDetail>(`/api/customers/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

export function useDeleteCustomer() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/customers/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useDeleteCustomerAddress() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: ({ customerId, addressId }: { customerId: string; addressId: string }) =>
      api<void>(`/api/customers/${customerId}/addresses/${addressId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useCreateCustomerTag() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: (input: { name: string; color: CustomerTagColor }) =>
      api<CustomerTag>("/api/customer-tags", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

export function useDeleteCustomerTag() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/customer-tags/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

/** One batch of at most 50 already parsed rows. */
export function useImportCustomers() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: (request: CustomerImportRequest) =>
      api<CustomerImportResult>("/api/customers/import", { method: "POST", body: JSON.stringify(request) }),
    onSuccess: invalidate,
  });
}

/** Downloads the list with the filters applied (no page). */
export async function downloadCustomersCsv(filters: CustomerFilters): Promise<void> {
  const qs = customerQueryString(filters, false);
  const res = await fetch(`/api/customers/export.csv${qs ? `?${qs}` : ""}`, { credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new ApiError(res.status, "EXPORT_FAILED", body?.error?.message ?? "No pudimos exportar los clientes.");
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1]! : `clientes-${localDateKey(Date.now())}.csv`;
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

/** The points of the heatmap are `CustomerHeatmapPoint`; exported for the map component. */
export type { CustomerHeatmapPoint };
