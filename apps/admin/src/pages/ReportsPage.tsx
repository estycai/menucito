import { Link, useSearchParams } from "react-router";
import { planLimitsFor, presetRange } from "@menucito/shared";
import { ComingSoon } from "@/components/ComingSoon";
import { ProLock } from "@/components/ProLock";
import { QueryError } from "@/components/QueryError";
import { EvolutionTab } from "@/components/reports/EvolutionTab";
import { BillingTab } from "@/components/reports/billing/BillingTab";
import { SalesTab } from "@/components/reports/sales/SalesTab";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { ReportTabs } from "@/components/reports/ReportTabs";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/lib/access";
import { ApiError, useMyRestaurant } from "@/lib/restaurant";
import { filtersFromSearch, searchWithFilters, searchWithTab, tabFromSearch, withDefaultRange } from "@/lib/report-filters";
import { filtersForAccess, visibleFilters, visibleTabs } from "@/lib/report-access";
import { useBillingReport, useEvolutionReport, useReportMeta, useSalesReport } from "@/lib/reports";
import { useDocumentTitle } from "@/lib/use-document-title";

const IMPLEMENTED_TABS = [
  { key: "stats.tab.evolution", label: "Evolución" },
  { key: "stats.tab.billing", label: "Facturación" },
  { key: "stats.tab.sales", label: "Ventas" },
] as const;

export function ReportsPage() {
  useDocumentTitle("Reportes");
  const { access, isOwner } = useAccess();
  const { data: restaurant } = useMyRestaurant();
  const [search, setParams] = useSearchParams();
  const planLocked = restaurant !== undefined && !planLimitsFor(restaurant?.plan ?? "basic").reports;
  const meta = useReportMeta(Boolean(access) && !planLocked);

  const availableTabs = access ? visibleTabs(access) : [];
  const tabs = IMPLEMENTED_TABS.filter((tab) => availableTabs.includes(tab.key));
  const requested = tabFromSearch(search);
  const active = tabs.find((tab) => tab.key === requested)?.key ?? tabs[0]?.key;
  const availableFilters = access ? visibleFilters(access) : [];
  const canSeeDate = availableFilters.includes("stats.f.date");
  // A filter the role lacks is neither shown, nor counted, nor sent (the API ignores it too).
  const urlFilters = filtersFromSearch(search);
  const filters = withDefaultRange(access ? filtersForAccess(access, urlFilters) : urlFilters, canSeeDate, new Date());
  const enabled = Boolean(access) && !planLocked;
  const evolution = useEvolutionReport(filters, enabled && active === "stats.tab.evolution");
  const billing = useBillingReport(filters, enabled && active === "stats.tab.billing");
  const sales = useSalesReport(filters, enabled && active === "stats.tab.sales");
  const report = active === "stats.tab.billing" ? billing : active === "stats.tab.sales" ? sales : evolution;

  const onFiltersChange = (next: typeof filters) => setParams(searchWithFilters(search, next), { replace: true });
  const onTabSelect = (key: string) => setParams(searchWithTab(search, key));
  const onLast7Days = () => {
    const range = presetRange("7d", new Date());
    onFiltersChange({ ...filters, ...range });
  };

  if (planLocked) {
    return <ComingSoon title="Reportes" />;
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Reportes</h1>
          <p className="m-0 text-sm text-muted">Los números de tu negocio, con el detalle de cada pedido entregado y pagado.</p>
        </div>
        {isOwner && (
          <Button asChild variant="outline" className="min-h-11 px-4 text-sm">
            <Link to="/reportes/configurar">Configurar vista por rol</Link>
          </Button>
        )}
      </div>

      <ReportTabs tabs={tabs} active={active ?? ""} onSelect={onTabSelect} />

      {tabs.length === 0 ? (
        <section className="rounded-2xl border border-line bg-white p-8 text-center">
          <h2 className="m-0 font-display text-xl font-extrabold">No tenés pestañas de Reportes habilitadas</h2>
          <p className="m-0 mt-2 text-sm text-muted">Pedile al dueño del local que te habilite alguna desde Configurar vista por rol.</p>
        </section>
      ) : (
        <>
          <ReportFilters
            filters={filters}
            onChange={onFiltersChange}
            available={availableFilters}
            canSeeDate={canSeeDate}
            meta={meta.data}
          />

          {report.isError ? (
            report.error instanceof ApiError && report.error.code === "PLAN_FEATURE" ? (
              <ProLock title="Reportes de ventas" description="Este local no tiene el plan que incluye Reportes." />
            ) : report.error instanceof ApiError && (report.error.code === "INVALID_REPORT_RANGE" || report.error.code === "VALIDATION_ERROR") ? (
              <section role="alert" className="rounded-2xl border border-line bg-white p-6 text-center text-sm">
                <p className="m-0 font-bold">{report.error.code === "INVALID_REPORT_RANGE" ? report.error.message : "Revisá las fechas del filtro."}</p>
                <p className="m-0 mt-1 text-muted">Elegí otro rango o un atajo de fecha.</p>
              </section>
            ) : (
              <QueryError message="No pudimos cargar los reportes." onRetry={() => void report.refetch()} retrying={report.isRefetching} />
            )
          ) : report.isPending || !report.data ? (
            <ReportSkeleton />
          ) : active === "stats.tab.billing" && billing.data ? (
            <BillingTab data={billing.data} access={access!} onLast7Days={onLast7Days} canSeeDate={canSeeDate} />
          ) : active === "stats.tab.sales" && sales.data ? (
            <SalesTab data={sales.data} access={access!} onLast7Days={onLast7Days} canSeeDate={canSeeDate} />
          ) : evolution.data ? (
            <EvolutionTab data={evolution.data} access={access!} onLast7Days={onLast7Days} canSeeDate={canSeeDate} />
          ) : null}
        </>
      )}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="Cargando los reportes">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-2xl bg-line-soft" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-2xl bg-line-soft" />
      <div className="h-56 animate-pulse rounded-2xl bg-line-soft" />
    </div>
  );
}
