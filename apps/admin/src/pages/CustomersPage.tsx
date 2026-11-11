import { useEffect, useId, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import {
  customerMapsUrl,
  customerWhatsappUrl,
  formatArs,
  formatCustomerPhone,
  localDateKey,
  type CustomerListItem,
  type CustomerSortField,
} from "@menucito/shared";
import { CustomerSheet } from "@/components/customers/CustomerSheet";
import { CustomerTagPill } from "@/components/customers/CustomerTagPill";
import { ImportCustomersDialog } from "@/components/customers/ImportCustomersDialog";
import { QueryError } from "@/components/QueryError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccess } from "@/lib/access";
import { useCatalog } from "@/lib/catalog";
import {
  activeCustomerFilterCount,
  customerFiltersFromSearch,
  downloadCustomersCsv,
  searchWithCustomerFilters,
  useCustomers,
  useCustomerTags,
  type CustomerFilters,
} from "@/lib/customers";
import { useDocumentTitle } from "@/lib/use-document-title";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

const dayLabel = (ms: number | null) => {
  if (ms === null) return "—";
  const [year = "", month = "", day = ""] = localDateKey(ms).split("-");
  return `${day}/${month}/${year.slice(2)}`;
};

/** "Clientes" (change 17a): list with search, filters, sort, pages, CSV export and import. */
export function CustomersPage() {
  useDocumentTitle("Clientes");
  const { can } = useAccess();
  const [search, setSearch] = useSearchParams();
  const filters = customerFiltersFromSearch(search);
  const query = useCustomers(filters);
  const tags = useCustomerTags();
  const catalog = useCatalog(can("menu.view"));
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [text, setText] = useState(filters.q ?? "");

  const apply = (next: Partial<CustomerFilters>, resetPage = true) =>
    setSearch(searchWithCustomerFilters(search, { ...filters, ...next, ...(resetPage ? { page: 1 } : {}) }), {
      replace: true,
    });

  // The search box writes the URL after a short pause, so typing does not fire one request per key.
  useEffect(() => {
    if ((filters.q ?? "") === text.trim()) return;
    const timer = window.setTimeout(() => apply({ q: text.trim() || undefined }), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const products = (catalog.data?.categories ?? []).flatMap((category) => category.products);
  const data = query.data;
  const lastPage = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filterCount = activeCustomerFilterCount(filters);
  const mapSearch = searchWithCustomerFilters(new URLSearchParams(), { ...filters, page: 1 }).toString();

  const sortBy = (field: CustomerSortField) =>
    apply({
      sort: field,
      dir: filters.sort === field ? (filters.dir === "desc" ? "asc" : "desc") : field === "name" ? "asc" : "desc",
    });

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      await downloadCustomersCsv(filters);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "No pudimos exportar los clientes.");
    } finally {
      setExporting(false);
    }
  }

  const filterFields = (
    <FilterFields
      filters={filters}
      products={products.map((product) => ({ id: product.id, name: product.name }))}
      showProducts={can("menu.view")}
      tags={tags.data ?? []}
      onChange={apply}
    />
  );

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Clientes</h1>
          <span className="text-sm text-muted">
            {data ? `${data.total} ${data.total === 1 ? "cliente" : "clientes"}` : "Quiénes te compran y cuánto"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="px-4 text-sm font-bold">
            <Link to={`/clientes/mapa${mapSearch ? `?${mapSearch}` : ""}`}>Mapa de calor</Link>
          </Button>
          {can("customers.edit") && (
            <Button type="button" variant="outline" className="px-4 text-sm font-bold" onClick={() => setImporting(true)}>
              Importar
            </Button>
          )}
          {can("customers.export") && (
            <Button type="button" variant="outline" className="px-4 text-sm font-bold" disabled={exporting} onClick={() => void exportCsv()}>
              {exporting ? "Exportando…" : "Exportar CSV"}
            </Button>
          )}
        </div>
      </div>

      {exportError && (
        <p role="alert" className="m-0 text-sm font-semibold text-danger">
          {exportError}
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
        <div className="flex gap-2">
          <Input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Nombre o teléfono"
            aria-label="Buscar por nombre o teléfono"
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            className="px-4 text-sm font-bold md:hidden"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            {filterCount > 0 ? `Filtros (${filterCount})` : "Filtros"}
          </Button>
        </div>
        <div className="hidden md:block">{filterFields}</div>
        {filtersOpen && <div className="md:hidden">{filterFields}</div>}
        {filterCount > 0 && (
          <button
            type="button"
            className="self-start cursor-pointer text-sm font-semibold text-link hover:underline"
            onClick={() => apply({ from: undefined, to: undefined, product: undefined, tag: undefined })}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {query.isError ? (
        <QueryError message="No pudimos cargar los clientes." onRetry={() => void query.refetch()} />
      ) : query.isLoading || !data ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">Cargando los clientes…</div>
      ) : data.items.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">
          {filters.q || filterCount > 0
            ? "Ningún cliente coincide con la búsqueda o los filtros."
            : "Todavía no tenés clientes. Aparecen solos con cada pedido, o podés importarlos."}
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white md:block">
            <table className="w-full border-collapse text-left text-[15px]">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <SortHeader field="name" filters={filters} onSort={sortBy}>
                    Nombre
                  </SortHeader>
                  <th className="px-4 py-3.5 font-bold">WhatsApp</th>
                  <th className="px-4 py-3.5 font-bold">Dirección</th>
                  <SortHeader field="orders" filters={filters} onSort={sortBy} right>
                    Pedidos
                  </SortHeader>
                  <SortHeader field="spent" filters={filters} onSort={sortBy} right>
                    Gasto total
                  </SortHeader>
                  <SortHeader field="last" filters={filters} onSort={sortBy}>
                    Último pedido
                  </SortHeader>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((customer) => (
                  <tr key={customer.id} className="hover:bg-tab/40">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setOpenId(customer.id)}
                        className="cursor-pointer text-left font-bold text-ink hover:underline"
                      >
                        {customer.name}
                      </button>
                      <TagRow customer={customer} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <PhoneLink phone={customer.phone} />
                    </td>
                    <td className="max-w-[260px] px-4 py-3">
                      <AddressCell customer={customer} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{customer.orders}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatArs(customer.spentCents)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{dayLabel(customer.lastOrderAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 md:hidden">
            <label className="flex items-center gap-2 text-sm text-muted">
              Ordenar por
              <select
                className="min-h-11 flex-1 rounded-xl border border-line bg-white px-3 text-sm text-ink"
                value={`${filters.sort}:${filters.dir}`}
                onChange={(event) => {
                  const [sort, dir] = event.target.value.split(":") as [CustomerSortField, "asc" | "desc"];
                  apply({ sort, dir });
                }}
              >
                <option value="orders:desc">Más pedidos</option>
                <option value="spent:desc">Mayor gasto</option>
                <option value="last:desc">Pedido más reciente</option>
                <option value="since:asc">Clientes más antiguos</option>
                <option value="name:asc">Nombre (A-Z)</option>
              </select>
            </label>
            {data.items.map((customer) => (
              <article key={customer.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
                <button
                  type="button"
                  onClick={() => setOpenId(customer.id)}
                  className="cursor-pointer text-left text-base font-bold text-ink"
                >
                  {customer.name}
                </button>
                <TagRow customer={customer} />
                <PhoneLink phone={customer.phone} />
                <div className="text-sm">
                  <AddressCell customer={customer} />
                </div>
                <div className="flex flex-wrap justify-between gap-2 text-sm text-muted">
                  <span>
                    {customer.orders} {customer.orders === 1 ? "pedido" : "pedidos"}
                  </span>
                  <span className="font-bold text-ink tabular-nums">{formatArs(customer.spentCents)}</span>
                  <span>Último: {dayLabel(customer.lastOrderAt)}</span>
                </div>
              </article>
            ))}
          </div>

          <nav aria-label="Páginas" className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">
              Página {data.page} de {lastPage}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={filters.page <= 1 || query.isFetching}
                onClick={() => apply({ page: filters.page - 1 }, false)}
                className="min-h-11 px-4 text-sm"
              >
                Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={filters.page >= lastPage || query.isFetching}
                onClick={() => apply({ page: filters.page + 1 }, false)}
                className="min-h-11 px-4 text-sm"
              >
                Siguiente
              </Button>
            </div>
          </nav>
        </>
      )}

      {openId && <CustomerSheet customerId={openId} onClose={() => setOpenId(null)} />}
      {importing && <ImportCustomersDialog onClose={() => setImporting(false)} />}
    </div>
  );
}

interface FilterFieldsProps {
  filters: CustomerFilters;
  products: { id: string; name: string }[];
  showProducts: boolean;
  tags: { id: string; name: string }[];
  onChange: (next: Partial<CustomerFilters>) => void;
}

/** Date range, "Compró" and "Etiqueta". */
export function FilterFields({ filters, products, showProducts, tags, onChange }: FilterFieldsProps) {
  const id = useId();
  const selectClass = "min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink";
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Pidió desde" htmlFor={`${id}-from`}>
        <Input
          id={`${id}-from`}
          type="date"
          value={filters.from ?? ""}
          max={filters.to}
          onChange={(event) => onChange({ from: event.target.value || undefined })}
        />
      </Field>
      <Field label="Hasta" htmlFor={`${id}-to`}>
        <Input
          id={`${id}-to`}
          type="date"
          value={filters.to ?? ""}
          min={filters.from}
          onChange={(event) => onChange({ to: event.target.value || undefined })}
        />
      </Field>
      {showProducts && (
        <Field label="Compró" htmlFor={`${id}-product`}>
          <select
            id={`${id}-product`}
            className={selectClass}
            value={filters.product ?? ""}
            onChange={(event) => onChange({ product: event.target.value || undefined })}
          >
            <option value="">Cualquier producto</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Etiqueta" htmlFor={`${id}-tag`}>
        <select
          id={`${id}-tag`}
          className={selectClass}
          value={filters.tag ?? ""}
          onChange={(event) => onChange({ tag: event.target.value || undefined })}
        >
          <option value="">Todas</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-bold text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function SortHeader({
  field,
  filters,
  onSort,
  right = false,
  children,
}: {
  field: CustomerSortField;
  filters: CustomerFilters;
  onSort: (field: CustomerSortField) => void;
  right?: boolean;
  children: string;
}) {
  const active = filters.sort === field;
  return (
    <th
      className={cn("px-4 py-3.5 font-bold", right && "text-right")}
      aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn("cursor-pointer font-bold hover:text-ink", active && "text-ink")}
      >
        {children}
        {active ? (filters.dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

function TagRow({ customer }: { customer: CustomerListItem }) {
  if (customer.tags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {customer.tags.map((tag) => (
        <CustomerTagPill key={tag.id} tag={tag} />
      ))}
    </div>
  );
}

function PhoneLink({ phone }: { phone: string }) {
  return (
    <a
      href={customerWhatsappUrl(phone)}
      target="_blank"
      rel="noreferrer"
      className="text-sm font-semibold text-link hover:underline"
    >
      {formatCustomerPhone(phone)}
    </a>
  );
}

function AddressCell({ customer }: { customer: CustomerListItem }) {
  if (!customer.address) return <span className="text-muted">—</span>;
  if (customer.addressLat === null || customer.addressLng === null) {
    return <span className="break-words">{customer.address}</span>;
  }
  return (
    <a
      href={customerMapsUrl(customer.addressLat, customer.addressLng)}
      target="_blank"
      rel="noreferrer"
      className="break-words text-link hover:underline"
    >
      {customer.address}
    </a>
  );
}
