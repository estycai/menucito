import { lazy, Suspense, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { hasCoordinates } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { QueryError } from "@/components/QueryError";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/lib/access";
import { useCatalog } from "@/lib/catalog";
import { GOOGLE_MAPS_KEY } from "@/lib/config";
import {
  customerFiltersFromSearch,
  searchWithCustomerFilters,
  useCustomerHeatmap,
  useCustomerTags,
  type CustomerFilters,
} from "@/lib/customers";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useStoreLocation } from "@/lib/zones";

const CustomersHeatmapCanvas = lazy(() => import("@/components/customers/CustomersHeatmapCanvas"));

const dayLabel = (key: string) => {
  const [year = "", month = "", day = ""] = key.split("-");
  return `${day}/${month}/${year.slice(2)}`;
};

/** "Mapa de calor" (change 17a): where the customers live, with the filters of the list as chips. */
export function CustomersMapPage() {
  useDocumentTitle("Mapa de clientes");
  const { can } = useAccess();
  const [search, setSearch] = useSearchParams();
  const filters = customerFiltersFromSearch(search);
  const heatmap = useCustomerHeatmap(filters);
  const tags = useCustomerTags();
  const catalog = useCatalog(can("menu.view"));
  const location = useStoreLocation(can("store.view"));
  const locationData = location.data;
  const store = useMemo(
    () => (locationData && hasCoordinates(locationData) ? { lat: locationData.lat, lng: locationData.lng } : null),
    [locationData],
  );

  const listSearch = searchWithCustomerFilters(new URLSearchParams(), { ...filters, page: 1 }).toString();
  const remove = (next: Partial<CustomerFilters>) =>
    setSearch(searchWithCustomerFilters(search, { ...filters, ...next, page: 1 }), { replace: true });

  const productName = (catalog.data?.categories ?? [])
    .flatMap((category) => category.products)
    .find((product) => product.id === filters.product)?.name;
  const tagName = (tags.data ?? []).find((tag) => tag.id === filters.tag)?.name;

  const chips: { key: string; label: string; clear: Partial<CustomerFilters> }[] = [];
  if (filters.q) chips.push({ key: "q", label: `“${filters.q}”`, clear: { q: undefined } });
  if (filters.from || filters.to) {
    const label = filters.from && filters.to
      ? `${dayLabel(filters.from)} al ${dayLabel(filters.to)}`
      : filters.from
        ? `Desde ${dayLabel(filters.from)}`
        : `Hasta ${dayLabel(filters.to ?? "")}`;
    chips.push({ key: "dates", label: `Pidió ${label}`, clear: { from: undefined, to: undefined } });
  }
  if (filters.product) chips.push({ key: "product", label: `Compró ${productName ?? "un producto"}`, clear: { product: undefined } });
  if (filters.tag) chips.push({ key: "tag", label: `Etiqueta ${tagName ?? ""}`.trim(), clear: { tag: undefined } });

  const data = heatmap.data;
  const points = useMemo(() => data?.points ?? [], [data]);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Mapa de calor</h1>
          <span className="text-sm text-muted">Más intensidad donde hay más pedidos.</span>
        </div>
        <Button asChild variant="outline" className="px-4 text-sm font-bold">
          <Link to={`/clientes${listSearch ? `?${listSearch}` : ""}`}>Volver a la lista</Link>
        </Button>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Filtros aplicados">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => remove(chip.clear)}
              aria-label={`Quitar filtro: ${chip.label}`}
              className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-line bg-white px-3 text-sm font-semibold hover:bg-tab"
            >
              {chip.label}
              <span aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
      )}

      {!GOOGLE_MAPS_KEY ? (
        <Notice tone="warning">El mapa no está disponible: falta configurar la clave de Google Maps.</Notice>
      ) : heatmap.isError ? (
        <QueryError message="No pudimos cargar el mapa de clientes." onRetry={() => void heatmap.refetch()} />
      ) : heatmap.isLoading || !data ? (
        <div className="h-[420px] animate-pulse rounded-2xl bg-tab lg:h-[600px]" aria-label="Cargando mapa" role="status" />
      ) : (
        <>
          <Suspense
            fallback={<div className="h-[420px] animate-pulse rounded-2xl bg-tab lg:h-[600px]" aria-label="Cargando mapa" role="status" />}
          >
            <CustomersHeatmapCanvas store={store} points={points} />
          </Suspense>
          <p className="m-0 text-sm text-muted">
            {data.total} {data.total === 1 ? "cliente" : "clientes"} · {data.points.length} en el mapa
            {data.withoutAddress > 0 &&
              ` · ${data.withoutAddress} sin dirección ubicada`}
            {store ? " · ★ Tu local" : ""}
          </p>
        </>
      )}
    </div>
  );
}
