import { useState, type ReactNode } from "react";
import { Notice } from "@/components/AuthLayout";
import { FormField } from "@/components/FormField";
import { QueryError } from "@/components/QueryError";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  checkSettings,
  sectionValues,
  useStoreSettings,
  useUpdateStoreSettings,
  valuesFromSettings,
  type SectionValues,
  type SettingsSection,
  type StoreSettings,
} from "@/lib/settings";

const SETTINGS_LOAD_MESSAGES = {
  loadFailed: "No pudimos cargar la configuración.",
} as const;

/** Loads the store settings and renders `children` with them, or the load error with a retry. */
export function StoreSettingsGate({ children }: { children: (settings: StoreSettings) => ReactNode }) {
  const { data: settings, isError, isRefetching, refetch } = useStoreSettings();

  if (!settings) {
    return isError ? (
      <QueryError message={SETTINGS_LOAD_MESSAGES.loadFailed} onRetry={() => void refetch()} retrying={isRefetching} />
    ) : null;
  }

  return children(settings);
}

const RECEPTION_MESSAGES = {
  activeAnnouncement: "Tu local vuelve a recibir pedidos",
  pausedAnnouncement: "Tu local ya no recibe pedidos",
  saveFailed: "No pudimos guardar el cambio. Probá de nuevo.",
} as const;

/** Container: saves the switch with an optimistic value that reverts when the save fails. */
export function ReceptionCard({ settings }: { settings: StoreSettings }) {
  const update = useUpdateStoreSettings();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accepting = optimistic ?? settings.acceptingOrders;

  async function handleToggle(next: boolean) {
    setOptimistic(next);
    setError(null);
    setAnnouncement(next ? RECEPTION_MESSAGES.activeAnnouncement : RECEPTION_MESSAGES.pausedAnnouncement);

    try {
      await update.mutateAsync({ acceptingOrders: next });
      setOptimistic(null);
    } catch {
      setOptimistic(null); // revert switch
      setError(RECEPTION_MESSAGES.saveFailed);
      setAnnouncement(null);
    }
  }

  return (
    <ReceptionCardView
      accepting={accepting}
      saving={update.isPending}
      announcement={announcement}
      error={error}
      onToggle={handleToggle}
    />
  );
}

function ReceptionCardView({
  accepting,
  saving,
  announcement,
  error,
  onToggle,
}: {
  accepting: boolean;
  saving: boolean;
  announcement: string | null;
  error: string | null;
  onToggle: (next: boolean) => void;
}) {
  return (
    <SectionCard
      title="Recepción de pedidos"
      description="Pausá la recepción cuando no puedas tomar pedidos. Tu menú sigue visible para tus clientes."
      action={<Switch checked={accepting} onCheckedChange={onToggle} disabled={saving} aria-label="Recibir pedidos" />}
      actionAlign="center"
    >
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
    </SectionCard>
  );
}

const SETTINGS_CARD_MESSAGES = {
  saved: "Cambios guardados",
  saveFailed: "No pudimos guardar los cambios. Probá de nuevo.",
  incompleteTransferWarning: "Completá el alias y el titular para que tus clientes sepan dónde transferir.",
} as const;

/**
 * Draft and save of one settings card. The draft holds the card's own fields; the rest come from the
 * saved settings, so the PATCH carries only this card's changes.
 */
function useSettingsSection<S extends SettingsSection>(section: S, settings: StoreSettings) {
  const update = useUpdateStoreSettings();
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const [draft, setDraft] = useState<SectionValues<S>>(() => sectionValues(section, valuesFromSettings(settings)));

  const check = checkSettings(settings, { ...valuesFromSettings(settings), ...draft });

  function change<F extends keyof SectionValues<S>>(field: F, value: SectionValues<S>[F]) {
    setStatus(null);
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!check.changes || check.invalid) return;

    setStatus(null);
    try {
      const updated = await update.mutateAsync(check.changes);
      // Show the values as the API saved them (formatted amounts, trimmed alias).
      setDraft(sectionValues(section, valuesFromSettings(updated)));
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return {
    draft,
    check,
    change,
    handleSubmit,
    status,
    canSave: Boolean(check.changes) && !check.invalid && !update.isPending,
  };
}

/** Footer of a settings card: the saved notice and "Guardar cambios", then the save error. */
function SaveRow({ status, canSave }: { status: "saved" | "error" | null; canSave: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="min-w-0" aria-live="polite">
          {status === "saved" && <Notice tone="success">{SETTINGS_CARD_MESSAGES.saved}</Notice>}
        </div>
        <Button type="submit" className="min-h-12 rounded-xl px-[26px] text-[15px]" disabled={!canSave}>
          Guardar cambios
        </Button>
      </div>
      {status === "error" && <Notice tone="error">{SETTINGS_CARD_MESSAGES.saveFailed}</Notice>}
    </>
  );
}

export function MinOrderCard({ settings }: { settings: StoreSettings }) {
  const { draft, check, change, handleSubmit, status, canSave } = useSettingsSection("minOrder", settings);

  return (
    <SectionCard title="Pedido mínimo" description="El monto mínimo que tiene que sumar un pedido para que lo puedas recibir.">
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="sm:max-w-[280px]">
          <FormField
            label="Monto mínimo"
            prefix="$"
            inputMode="numeric"
            value={draft.minOrder}
            onChange={(e) => change("minOrder", e.target.value)}
            hint="Dejalo vacío si no hay pedido mínimo."
            error={check.errors.minOrder}
          />
        </div>
        <SaveRow status={status} canSave={canSave} />
      </form>
    </SectionCard>
  );
}

export function ShippingCostCard({ settings }: { settings: StoreSettings }) {
  const { draft, check, change, handleSubmit, status, canSave } = useSettingsSection("shipping", settings);

  return (
    <SectionCard title="Costo de envío" description="Solo se suma en pedidos con envío a domicilio.">
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="sm:max-w-[280px]">
          <FormField
            label="Costo fijo"
            prefix="$"
            inputMode="numeric"
            value={draft.shipping}
            onChange={(e) => change("shipping", e.target.value)}
            hint="Poné 0 si el envío es gratis."
            error={check.errors.shipping}
          />
        </div>
        <SaveRow status={status} canSave={canSave} />
      </form>
    </SectionCard>
  );
}

export function PaymentMethodsCard({ settings }: { settings: StoreSettings }) {
  const { draft, check, change, handleSubmit, status, canSave } = useSettingsSection("payments", settings);

  return (
    <SectionCard title="Formas de pago" description="Elegí cómo te pueden pagar tus clientes.">
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          {check.hasIncompleteTransferWarning && (
            <Notice tone="warning">{SETTINGS_CARD_MESSAGES.incompleteTransferWarning}</Notice>
          )}

          <div className="flex flex-col gap-3">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={draft.cashEnabled}
                onChange={(e) => change("cashEnabled", e.target.checked)}
                className="size-5 cursor-pointer rounded border-line accent-primary"
              />
              <span className="text-sm font-semibold">Efectivo</span>
            </label>

            <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={draft.transferEnabled}
                onChange={(e) => change("transferEnabled", e.target.checked)}
                className="size-5 cursor-pointer rounded border-line accent-primary"
              />
              <span className="text-sm font-semibold">Transferencia</span>
            </label>
          </div>

          {check.errors.methods && <p className="m-0 text-[13px] text-danger">{check.errors.methods}</p>}

          {draft.transferEnabled && (
            <div className="mt-2 flex flex-col gap-3 rounded-xl border border-line bg-bg/50 p-3.5 sm:p-4">
              <FormField
                label="Alias"
                placeholder="ej: marta.hamburguesas"
                value={draft.transferAlias}
                onChange={(e) => change("transferAlias", e.target.value)}
                error={check.errors.transferAlias}
              />
              <FormField
                label="Titular de la cuenta"
                placeholder="ej: Marta Gómez"
                value={draft.transferHolderName}
                onChange={(e) => change("transferHolderName", e.target.value)}
                error={check.errors.transferHolderName}
              />
            </div>
          )}
        </div>

        <SaveRow status={status} canSave={canSave} />
      </form>
    </SectionCard>
  );
}
