import { Suspense, lazy, useState } from "react";
import {
  type Access,
  type ReportRange,
  type SalesAddonRow,
  type SalesCategoriesBlock,
  type SalesCategoryRow,
  type SalesProductRow,
  type SalesReport,
  type SalesTopBlock,
} from "@menucito/shared";
import { ReportBlock } from "@/components/reports/ReportBlock";
import { ReportEmpty, ReportNoBlocks } from "@/components/reports/ReportEmpty";
import { ReportTable, type ReportColumn } from "@/components/reports/ReportTable";
import { canExport, canSeeAmounts } from "@/lib/report-access";
import { normalizeSearch } from "@/lib/report-search";
import { cn } from "@/lib/utils";

const TopChart = lazy(() => import("./SalesCharts").then((module) => ({ default: module.TopChart })));

const PAGE_SIZE = 20;
const PRODUCTS_NOTE = "Los montos no incluyen descuentos ni adicionales. Se usa la categoría actual del producto.";

interface SalesTabProps {
  data: SalesReport;
  access: Access;
  canSeeDate?: boolean;
  onLast7Days?: () => void;
}

/** Ventas tab of Reports (change 16b). */
export function SalesTab({ data, access, canSeeDate = true, onLast7Days }: SalesTabProps) {
  const amounts = canSeeAmounts(access);
  const exportable = canExport(access);
  const { widgets, range } = data;
  const [category, setCategory] = useState<string | null>(null);
  if (!data.hasActivity) return <ReportEmpty range={range} canSeeDate={canSeeDate} onLast7Days={onLast7Days} />;
  if (!Object.values(widgets).some(Boolean)) return <ReportNoBlocks />;

  return (
    <div className="flex flex-col gap-4">
      {widgets.top && <TopBlock top={widgets.top} amounts={amounts} />}
      {widgets.categories && (
        <CategoriesBlock
          block={widgets.categories}
          range={range}
          selected={category}
          // Filtering only makes sense when the role sees the products table.
          onSelect={widgets.products ? (name) => setCategory((current) => (current === name ? null : name)) : undefined}
          amounts={amounts}
          exportable={exportable}
        />
      )}
      {widgets.products && (
        <ProductsBlock
          rows={widgets.products}
          category={category}
          onClearCategory={() => setCategory(null)}
          range={range}
          amounts={amounts}
          exportable={exportable}
        />
      )}
      {widgets.addons && <AddonsBlock rows={widgets.addons} range={range} amounts={amounts} exportable={exportable} />}
    </div>
  );
}

function optionClass(active: boolean) {
  return cn(
    "min-h-11 shrink-0 cursor-pointer rounded-full px-3 text-xs font-bold",
    active ? "bg-ink text-white" : "bg-tab text-muted hover:text-ink",
  );
}

function TopBlock({ top, amounts }: { top: SalesTopBlock; amounts: boolean }) {
  const [metric, setMetric] = useState<"units" | "revenue">("units");
  const effective = amounts ? metric : "units";
  const list = effective === "revenue" ? (top.byRevenue ?? top.byUnits) : top.byUnits;
  const data = list.map((row) => ({
    name: row.name,
    value: effective === "revenue" ? (row.revenueCents ?? 0) : row.units,
  }));

  return (
    <ReportBlock
      title="Top 10 de productos"
      action={
        <div role="group" aria-label="Orden del Top 10" className="flex flex-wrap gap-1">
          <button type="button" aria-pressed={effective === "units"} onClick={() => setMetric("units")} className={optionClass(effective === "units")}>
            Por unidades
          </button>
          {amounts && (
            <button type="button" aria-pressed={effective === "revenue"} onClick={() => setMetric("revenue")} className={optionClass(effective === "revenue")}>
              Por facturado
            </button>
          )}
        </div>
      }
    >
      {data.length === 0 ? (
        <p className="m-0 text-sm text-muted">No hay productos vendidos en el período.</p>
      ) : (
        <Suspense fallback={<div className="h-[260px] animate-pulse rounded-xl bg-bg" aria-hidden="true" />}>
          <TopChart data={data} money={effective === "revenue"} />
        </Suspense>
      )}
    </ReportBlock>
  );
}

function CategoriesBlock({
  block,
  range,
  selected,
  onSelect,
  amounts,
  exportable,
}: {
  block: SalesCategoriesBlock;
  range: ReportRange;
  selected: string | null;
  onSelect?: (category: string) => void;
  amounts: boolean;
  exportable: boolean;
}) {
  const columns: ReportColumn<SalesCategoryRow>[] = [
    { key: "category", header: "Categoría", kind: "text", value: (row) => row.category },
    { key: "products", header: "Productos", kind: "count", value: (row) => row.products },
    { key: "units", header: "Unidades", kind: "count", value: (row) => row.units },
    { key: "revenue", header: "Facturado", kind: "money", value: (row) => row.revenueCents ?? 0 },
    { key: "percent", header: "%", kind: "percent", value: (row) => row.percent },
  ];
  return (
    <ReportTable
      title="Ventas por categoría"
      description={onSelect ? "Tocá una categoría para filtrar los productos; tocala de nuevo para sacar el filtro." : undefined}
      rows={block.rows}
      columns={columns}
      rowKey={(row) => row.category}
      amounts={amounts}
      totalRow={block.total}
      onRowClick={onSelect ? (row) => onSelect(row.category) : undefined}
      isRowActive={(row) => row.category === selected}
      rowActionLabel={(row, active) => (active ? `Quitar el filtro ${row.category}` : `Filtrar los productos por ${row.category}`)}
      export={{ tab: "ventas", block: "categories", from: range.from, to: range.to, allowed: exportable }}
    />
  );
}

function SearchField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="flex w-full flex-col gap-1 text-xs font-bold text-muted sm:max-w-xs">
      {label}
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-normal text-ink"
      />
    </label>
  );
}

function ProductsBlock({
  rows,
  category,
  onClearCategory,
  range,
  amounts,
  exportable,
}: {
  rows: SalesProductRow[];
  category: string | null;
  onClearCategory: () => void;
  range: ReportRange;
  amounts: boolean;
  exportable: boolean;
}) {
  const [query, setQuery] = useState("");
  const term = normalizeSearch(query);
  const filtered = rows.filter(
    (row) => (!category || row.category === category) && (!term || normalizeSearch(row.name).includes(term) || normalizeSearch(row.category).includes(term)),
  );
  const columns: ReportColumn<SalesProductRow>[] = [
    { key: "category", header: "Categoría", kind: "text", value: (row) => row.category },
    { key: "name", header: "Producto", kind: "text", value: (row) => row.name },
    { key: "units", header: "Unidades", kind: "count", value: (row) => row.units },
    { key: "revenue", header: "Facturado", kind: "money", value: (row) => row.revenueCents ?? 0 },
  ];
  return (
    <ReportTable
      title="Productos"
      description={PRODUCTS_NOTE}
      toolbar={
        <div className="flex flex-wrap items-end gap-2">
          <SearchField label="Buscar producto" value={query} onChange={setQuery} placeholder="Nombre o categoría" />
          {category && (
            <button
              type="button"
              onClick={onClearCategory}
              aria-label={`Quitar el filtro de categoría ${category}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary/10 px-3 text-xs font-bold text-primary"
            >
              Categoría: {category} <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      }
      rows={filtered}
      columns={columns}
      rowKey={(row) => `${row.productId ?? row.name}-${row.category}`}
      amounts={amounts}
      pageSize={PAGE_SIZE}
      resetKey={`${term}|${category ?? ""}`}
      emptyMessage={query || category ? "No hay productos que coincidan con la búsqueda." : undefined}
      export={{ tab: "ventas", block: "products", from: range.from, to: range.to, allowed: exportable }}
    />
  );
}

function AddonsBlock({
  rows,
  range,
  amounts,
  exportable,
}: {
  rows: SalesAddonRow[];
  range: ReportRange;
  amounts: boolean;
  exportable: boolean;
}) {
  const [query, setQuery] = useState("");
  const term = normalizeSearch(query);
  const filtered = rows.filter((row) => !term || normalizeSearch(row.name).includes(term));
  const columns: ReportColumn<SalesAddonRow>[] = [
    { key: "name", header: "Adicional", kind: "text", value: (row) => row.name },
    { key: "units", header: "Unidades", kind: "count", value: (row) => row.units },
    { key: "revenue", header: "Facturado", kind: "money", value: (row) => row.revenueCents ?? 0 },
  ];
  return (
    <ReportTable
      title="Adicionales"
      description="Solo los extras que se cobran aparte: lo incluido en el producto no suma unidades."
      toolbar={<SearchField label="Buscar adicional" value={query} onChange={setQuery} placeholder="Nombre del adicional" />}
      rows={filtered}
      columns={columns}
      rowKey={(row) => row.name}
      amounts={amounts}
      emptyMessage={query ? "No hay adicionales que coincidan con la búsqueda." : undefined}
      export={{ tab: "ventas", block: "addons", from: range.from, to: range.to, allowed: exportable }}
    />
  );
}
