import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  REPORT_FILTER_PERMISSIONS,
  REPORT_GENERAL_PERMISSIONS,
  REPORT_TABS,
  isReportPermission,
  normalizePermissions,
  planLimitsFor,
  presetRange,
  type PermissionKey,
  type ReportFilters,
  type ReportTabKey,
} from "@menucito/shared";
import { ProLock } from "@/components/ProLock";
import { Modal } from "@/components/Modal";
import { QueryError } from "@/components/QueryError";
import { EvolutionTab } from "@/components/reports/EvolutionTab";
import { BillingTab } from "@/components/reports/billing/BillingTab";
import { SalesTab } from "@/components/reports/sales/SalesTab";
import { ReportFilters as ReportFiltersBar } from "@/components/reports/ReportFilters";
import { ReportTabs } from "@/components/reports/ReportTabs";
import { Switch } from "@/components/ui/switch";
import { useMyRestaurant } from "@/lib/restaurant";
import {
  clipBillingReport,
  clipEvolutionReport,
  clipSalesReport,
  filtersForAccess,
  reportViewSummary,
  simulatedAccess,
  toggleReportView,
  visibleFilters,
  visibleTabs,
} from "@/lib/report-access";
import { useBillingReport, useEvolutionReport, useReportMeta, useSalesReport } from "@/lib/reports";
import { useRoles, useUpdateRole } from "@/lib/roles";
import { useDocumentTitle } from "@/lib/use-document-title";
import { cn } from "@/lib/utils";

const PREVIEW_TABS = [
  { key: "stats.tab.evolution", label: "Evolución" },
  { key: "stats.tab.billing", label: "Facturación" },
  { key: "stats.tab.sales", label: "Ventas" },
] as const;

const GENERAL_HELP: Record<string, string> = {
  "stats.amounts": "Apagado: ve solo cantidades (pedidos, unidades, %).",
  "stats.export": "Muestra los botones Exportar de cada tabla.",
};

/** What each Evolución block shows, as board 36 tags it. */
const WIDGET_TAGS: Record<string, string> = {
  "stats.w.evolution.billed": "Monto",
  "stats.w.evolution.orders": "Cantidad",
  "stats.w.evolution.ticket": "Monto",
  "stats.w.evolution.shipping": "Monto",
  "stats.w.evolution.discounts": "Monto",
  "stats.w.evolution.cancellations": "Cantidad y monto",
  "stats.w.evolution.pnl": "Monto",
  "stats.w.evolution.pace": "Cantidad",
  "stats.w.evolution.trend": "Gráfico",
  "stats.w.evolution.heatmap": "Gráfico",
  "stats.w.evolution.movers": "Cantidad",
  "stats.w.evolution.payment_methods": "Gráfico y tabla",
  "stats.w.evolution.customers": "Tabla con teléfonos",
};

/** Striped background of a hidden item (board 36). */
const HIDDEN_STRIPES: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--color-bg) 0, var(--color-bg) 6px, var(--color-line-soft) 6px, var(--color-line-soft) 12px)",
};

type ConfirmAction =
  | { kind: "cancel" }
  | { kind: "role"; roleId: string }
  | { kind: "link"; href: string };

export function ReportConfigPage() {
  useDocumentTitle("Configurar vista");
  const navigate = useNavigate();
  const [search, setParams] = useSearchParams();
  const { data: restaurant } = useMyRestaurant();
  const planLocked = restaurant !== undefined && !planLimitsFor(restaurant?.plan ?? "basic").reports;
  const rolesQuery = useRoles();
  const updateRole = useUpdateRole();
  const meta = useReportMeta(!planLocked);

  const roles = useMemo(
    () => (rolesQuery.data ?? []).filter((role) => role.active && !role.isSystem),
    [rolesQuery.data],
  );
  const requestedId = search.get("rol");
  const requestedMissing = requestedId !== null && rolesQuery.isSuccess && !roles.some((role) => role.id === requestedId);
  const role = roles.find((candidate) => candidate.id === requestedId) ?? roles[0];

  const [draftState, setDraftState] = useState<{ roleId: string; permissions: PermissionKey[] } | null>(null);
  const [blockTab, setBlockTab] = useState<ReportTabKey>("stats.tab.evolution");
  const [previewTab, setPreviewTab] = useState<ReportTabKey>("stats.tab.evolution");
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [previewFilters, setPreviewFilters] = useState<ReportFilters>(() => {
    const range = presetRange("7d", new Date());
    return { from: range.from, to: range.to };
  });

  const draftForRole =
    role && draftState?.roleId === role.id ? draftState.permissions : (role?.permissions ?? []);
  const reportDraft = draftForRole.filter((key) => isReportPermission(key));
  const savedReport = (role?.permissions ?? []).filter((key) => isReportPermission(key));
  const dirtyCount = role
    ? reportDraft.filter((key) => !savedReport.includes(key)).length + savedReport.filter((key) => !reportDraft.includes(key)).length
    : 0;
  const dirty = dirtyCount > 0;
  const simulated = role ? simulatedAccess(role, draftForRole) : null;
  const previewTabs = simulated ? visibleTabs(simulated).filter((key) => PREVIEW_TABS.some((tab) => tab.key === key)) : [];
  const previewAvailableFilters = simulated ? visibleFilters(simulated) : [];
  const previewCanSeeDate = previewAvailableFilters.includes("stats.f.date");
  const activePreviewTab = previewTabs.includes(previewTab) ? previewTab : previewTabs[0];
  const previewEvolution = activePreviewTab === "stats.tab.evolution";
  const previewBilling = activePreviewTab === "stats.tab.billing";
  const previewSales = activePreviewTab === "stats.tab.sales";
  const previewQueryFilters = simulated ? filtersForAccess(simulated, previewFilters) : previewFilters;
  const evolutionQuery = useEvolutionReport(previewQueryFilters, !planLocked && previewEvolution);
  const billingQuery = useBillingReport(previewQueryFilters, !planLocked && previewBilling);
  const salesQuery = useSalesReport(previewQueryFilters, !planLocked && previewSales);
  const report = previewBilling ? billingQuery : previewSales ? salesQuery : evolutionQuery;

  // Warn on reload or tab close while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // The shell's links are plain anchors: ask before leaving the screen with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const href = anchor?.getAttribute("href");
      if (!href || anchor?.target === "_blank" || /^(https?:|#|mailto:)/.test(href) || href.startsWith("/reportes/configurar")) return;
      event.preventDefault();
      event.stopPropagation();
      setConfirm({ kind: "link", href });
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [dirty]);

  if (planLocked) {
    return (
      <PageShell>
        <ProLock title="Reportes de ventas" description="Configurar la vista por rol está disponible en el plan Pro." />
      </PageShell>
    );
  }

  if (rolesQuery.isPending) {
    return (
      <PageShell>
        <p className="m-0 text-muted">Cargando roles...</p>
      </PageShell>
    );
  }

  if (rolesQuery.isError) {
    return (
      <PageShell>
        <QueryError message="No pudimos cargar los roles." onRetry={() => void rolesQuery.refetch()} retrying={rolesQuery.isRefetching} />
      </PageShell>
    );
  }

  if (!role || !simulated) {
    return (
      <PageShell>
        <section className="rounded-2xl border border-line bg-white p-8 text-center">
          <h2 className="m-0 font-display text-xl font-extrabold">Primero creá un rol</h2>
          <p className="m-0 mt-2 text-sm text-muted">Configurar vista necesita un rol activo además del dueño.</p>
          <Link to="/usuarios/roles" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-bold text-white">
            Ir a Usuarios › Roles
          </Link>
        </section>
      </PageShell>
    );
  }

  const chosenTab = REPORT_TABS.find((tab) => tab.key === blockTab) ?? REPORT_TABS[0];
  const chosenTabOn = draftForRole.includes(chosenTab.key);
  const summary = reportViewSummary(draftForRole, chosenTab.key);
  const has = (key: PermissionKey) => draftForRole.includes(key);
  const toggle = (key: PermissionKey) => setDraftState({ roleId: role.id, permissions: toggleReportView(draftForRole, key) });

  async function save() {
    if (!role) return;
    const permissions = [
      ...role.permissions.filter((key) => !isReportPermission(key)),
      ...normalizePermissions(reportDraft),
    ];
    try {
      await updateRole.mutateAsync({ id: role.id, body: { permissions } });
      setDraftState(null);
      toast.success(`Listo. Los miembros con el rol ${role.name} ya ven Reportes así.`);
    } catch {
      toast.error("No pudimos guardar los cambios. Probá de nuevo.");
    }
  }

  function goToRole(roleId: string) {
    const next = new URLSearchParams(search);
    next.set("rol", roleId);
    setParams(next);
  }

  function changeRole(roleId: string) {
    if (dirty) {
      setConfirm({ kind: "role", roleId });
      return;
    }
    goToRole(roleId);
  }

  function cancel() {
    if (dirty) {
      setConfirm({ kind: "cancel" });
      return;
    }
    navigate("/reportes");
  }

  function confirmAction() {
    if (!confirm) return;
    // Every way out discards the draft, so coming back to the role starts from what is saved.
    setDraftState(null);
    if (confirm.kind === "cancel") navigate("/reportes");
    else if (confirm.kind === "role") goToRole(confirm.roleId);
    else navigate(confirm.href);
    setConfirm(null);
  }

  return (
    <PageShell>
      <div
        role="region"
        aria-label="Modo configurar vista"
        // Sticky so "Guardar cambios" stays reachable while scrolling (below the 56 px mobile top bar).
        className="sticky top-[64px] z-10 flex flex-col gap-3 rounded-2xl bg-ink p-4 text-white shadow-lg sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:top-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="config-role" className="text-sm font-bold">
            Configurando la vista de
          </label>
          <select
            id="config-role"
            value={role.id}
            onChange={(event) => changeRole(event.target.value)}
            className="min-h-11 rounded-xl border border-white/30 bg-white/10 px-3 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-white/40"
          >
            {roles.map((candidate) => (
              <option key={candidate.id} value={candidate.id} className="text-ink">
                {candidate.name}
              </option>
            ))}
          </select>
          {dirty && (
            <span className="text-xs font-bold text-accent" aria-live="polite">
              {dirtyCount === 1 ? "1 cambio sin guardar" : `${dirtyCount} cambios sin guardar`}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={cancel} className="min-h-11 cursor-pointer rounded-xl border border-white/40 px-4 text-sm font-bold text-white hover:bg-white/10">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || updateRole.isPending}
            className="min-h-11 cursor-pointer rounded-xl bg-primary px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updateRole.isPending ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>

      {requestedMissing && (
        <p role="status" className="m-0 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
          El rol que pediste no está activo o ya no existe. Estás configurando {role.name}.
        </p>
      )}

      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-display text-[28px] font-extrabold">Vista previa: {role.name}</h1>
        <p className="m-0 max-w-[820px] text-sm text-muted">
          Tocá el ojo de cada pestaña, filtro o bloque para mostrarlo u ocultarlo a este rol. Lo que ves abajo es lo que va a
          ver. Los mismos permisos se pueden editar desde Usuarios › Roles.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" aria-live="polite">
        <Pill>
          {summary.tabs.on} de {summary.tabs.total} pestañas
        </Pill>
        <Pill>
          {summary.filters.on} de {summary.filters.total} filtros
        </Pill>
        <Pill>
          {summary.widgets.on} de {summary.widgets.total} bloques de {chosenTab.label}
        </Pill>
      </div>

      <Card title="Permisos generales">
        <div className="flex flex-wrap gap-3">
          {REPORT_GENERAL_PERMISSIONS.map((entry) => (
            <div key={entry.key} className="flex min-w-[min(320px,100%)] flex-1 items-center justify-between gap-4 rounded-xl border border-line px-4 py-3">
              <div>
                <b className="text-sm">{entry.label}</b>
                <p className="m-0 mt-0.5 text-xs text-muted">{GENERAL_HELP[entry.key]}</p>
              </div>
              <Switch checked={has(entry.key)} onCheckedChange={() => toggle(entry.key)} aria-label={entry.label} />
            </div>
          ))}
        </div>
      </Card>

      <Card title="Filtros">
        <div className="flex flex-wrap gap-2">
          {REPORT_FILTER_PERMISSIONS.map((filter) => (
            <EyeChip key={filter.key} label={filter.label} visible={has(filter.key)} onToggle={() => toggle(filter.key)} />
          ))}
        </div>
        <p className="m-0 text-xs text-muted">Un filtro oculto no aparece y el rol ve los datos sin ese filtro (todo junto).</p>
      </Card>

      <Card title="Pestañas">
        <div className="flex flex-wrap gap-2 border-b border-line pb-3">
          {REPORT_TABS.map((tab) => (
            <EyeChip key={tab.key} label={tab.label} visible={has(tab.key)} onToggle={() => toggle(tab.key)} />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 text-xs font-bold tracking-wide text-muted uppercase">Bloques de</h3>
          <div role="group" aria-label="Pestaña de los bloques" className="flex flex-wrap gap-1">
            {REPORT_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={blockTab === tab.key}
                onClick={() => setBlockTab(tab.key)}
                className={cn(
                  "min-h-11 cursor-pointer rounded-full px-3 text-xs font-bold",
                  blockTab === tab.key ? "bg-ink text-white" : "bg-tab text-muted hover:text-ink",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))" }}>
          {chosenTab.widgets.map((widget) => {
            const visible = chosenTabOn && has(widget.key);
            return (
              <div
                key={widget.key}
                className={cn(
                  "flex min-h-[112px] flex-col gap-2.5 rounded-xl border p-3.5",
                  visible ? "border-line bg-white" : "border-dashed border-line-strong",
                )}
                style={visible ? undefined : HIDDEN_STRIPES}
              >
                <div className="flex items-center justify-between gap-2">
                  <b className={cn("text-sm", !visible && "text-muted line-through")}>{widget.label}</b>
                  <EyeButton
                    label={widget.label}
                    visible={visible}
                    disabled={!chosenTabOn}
                    onToggle={() => toggle(widget.key)}
                  />
                </div>
                <span aria-hidden="true" className={cn("h-2.5 w-4/5 rounded bg-line-soft", !visible && "opacity-30")} />
                <span aria-hidden="true" className={cn("h-2.5 w-1/2 rounded bg-line-soft", !visible && "opacity-30")} />
                <span className="text-[11px] font-bold text-muted">
                  {chosenTabOn ? (WIDGET_TAGS[widget.key] ?? (visible ? "Visible" : "Oculto")) : `Oculto: la pestaña ${chosenTab.label} está oculta`}
                </span>
              </div>
            );
          })}
        </div>
        <p className="m-0 text-xs text-muted">Si una pestaña está oculta, sus bloques también lo están.</p>
      </Card>

      <section aria-labelledby="config-preview" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="config-preview" className="m-0 font-display text-xl font-extrabold">
            Así ve Reportes el rol {role.name}
          </h2>
          <p className="m-0 text-sm text-muted">Los datos se muestran como los vería el rol. No se inicia sesión como él.</p>
        </div>
        <ReportFiltersBar
          filters={previewQueryFilters}
          onChange={setPreviewFilters}
          available={previewAvailableFilters}
          canSeeDate={previewCanSeeDate}
          meta={meta.data}
          compact
        />
        <ReportTabs
          tabs={PREVIEW_TABS.filter((tab) => previewTabs.includes(tab.key))}
          active={activePreviewTab ?? ""}
          onSelect={(key) => setPreviewTab(key as ReportTabKey)}
        />
        {!activePreviewTab ? (
          <section className="rounded-2xl border border-line bg-white p-8 text-center text-sm text-muted">
            {previewTabs.length === 0 && visibleTabs(simulated).length > 0
              ? "Las pestañas que ve este rol todavía no tienen pantalla (Repartidores y Arqueos llegan pronto)."
              : "Con este borrador, el rol no ve ninguna pestaña de Reportes."}
          </section>
        ) : report.isError ? (
          <QueryError message="No pudimos cargar la vista previa." onRetry={() => void report.refetch()} retrying={report.isRefetching} />
        ) : report.isPending || !report.data ? (
          <div className="h-64 animate-pulse rounded-2xl bg-line-soft" aria-label="Cargando la vista previa" />
        ) : previewBilling && billingQuery.data ? (
          <BillingTab data={clipBillingReport(billingQuery.data, simulated)} access={simulated} canSeeDate={previewCanSeeDate} onLast7Days={() => setPreviewFilters({ ...previewFilters, ...presetRange("7d", new Date()) })} />
        ) : previewSales && salesQuery.data ? (
          <SalesTab data={clipSalesReport(salesQuery.data, simulated)} access={simulated} canSeeDate={previewCanSeeDate} onLast7Days={() => setPreviewFilters({ ...previewFilters, ...presetRange("7d", new Date()) })} />
        ) : evolutionQuery.data ? (
          <EvolutionTab
            data={clipEvolutionReport(evolutionQuery.data, simulated)}
            access={simulated}
            onLast7Days={() => setPreviewFilters({ ...previewFilters, ...presetRange("7d", new Date()) })}
            canSeeDate={previewCanSeeDate}
          />
        ) : null}
      </section>

      {confirm && (
        <Modal title="Cambios sin guardar" onClose={() => setConfirm(null)} size="sm">
          <p className="m-0 text-sm text-muted">
            {dirtyCount === 1 ? "Hay 1 cambio sin guardar." : `Hay ${dirtyCount} cambios sin guardar.`} Si seguís, se pierden.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setConfirm(null)} className="min-h-11 cursor-pointer rounded-xl border border-line px-4 text-sm font-bold">
              Seguir editando
            </button>
            <button type="button" onClick={confirmAction} className="min-h-11 cursor-pointer rounded-xl bg-primary px-4 text-sm font-bold text-white">
              {confirm.kind === "role" ? "Cambiar de rol" : confirm.kind === "link" ? "Salir sin guardar" : "Descartar cambios"}
            </button>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">{children}</div>;
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-primary-soft px-3 py-1.5 text-[13px] font-bold text-link">{children}</span>;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3.5 rounded-2xl border border-line bg-white p-4 sm:p-5">
      <h2 className="m-0 text-xs font-bold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {open ? (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
        </>
      )}
    </svg>
  );
}

/** A filter or tab with its eye: the whole chip toggles, struck through and striped when hidden. */
function EyeChip({ label, visible, onToggle }: { label: string; visible: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={visible}
      onClick={onToggle}
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        visible ? "border-line-strong bg-white text-ink" : "border-dashed border-line-strong text-muted",
      )}
      style={visible ? undefined : HIDDEN_STRIPES}
    >
      <EyeIcon open={visible} />
      <span className={cn(!visible && "line-through")}>{label}</span>
    </button>
  );
}

/** The eye of a block card (44 px), red when the block is hidden. */
function EyeButton({ label, visible, disabled, onToggle }: { label: string; visible: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={visible}
      aria-label={visible ? `Ocultar ${label}` : `Mostrar ${label}`}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border disabled:cursor-not-allowed disabled:opacity-60",
        visible ? "border-line-strong bg-white text-ink" : "border-danger-soft bg-danger-soft/50 text-danger",
      )}
    >
      <EyeIcon open={visible} />
    </button>
  );
}
