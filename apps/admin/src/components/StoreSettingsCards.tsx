import { useState, type ReactNode } from "react";
import { UPCOMING_PAYMENT_METHODS } from "@menucito/shared";
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

const SWITCH_SAVE_FAILED = "No pudimos guardar el cambio. Probá de nuevo.";

/** A settings flag shown as a card with a switch. */
interface SwitchSettingProps {
  field: "acceptingOrders" | "acceptOrdersOutsideHours";
  title: string;
  description: string;
  ariaLabel: string;
  /** Screen reader announcements after turning it on and off. */
  onAnnouncement: string;
  offAnnouncement: string;
}

/** Container: saves the switch with an optimistic value that reverts when the save fails. */
function SwitchSettingCard({ settings, ...card }: SwitchSettingProps & { settings: StoreSettings }) {
  const update = useUpdateStoreSettings();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checked = optimistic ?? settings[card.field];

  async function handleToggle(next: boolean) {
    setOptimistic(next);
    setError(null);
    setAnnouncement(next ? card.onAnnouncement : card.offAnnouncement);

    try {
      await update.mutateAsync({ [card.field]: next });
      setOptimistic(null);
    } catch {
      setOptimistic(null); // revert switch
      setError(SWITCH_SAVE_FAILED);
      setAnnouncement(null);
    }
  }

  return (
    <SectionCard
      title={card.title}
      description={card.description}
      action={<Switch checked={checked} onCheckedChange={handleToggle} disabled={update.isPending} aria-label={card.ariaLabel} />}
      actionAlign="center"
    >
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
    </SectionCard>
  );
}

export function ReceptionCard({ settings }: { settings: StoreSettings }) {
  return (
    <SwitchSettingCard
      settings={settings}
      field="acceptingOrders"
      title="Recepción de pedidos"
      description="Pausá la recepción cuando no puedas tomar pedidos. Tu menú sigue visible para tus clientes."
      ariaLabel="Recibir pedidos"
      onAnnouncement="Tu local vuelve a recibir pedidos"
      offAnnouncement="Tu local ya no recibe pedidos"
    />
  );
}

/** Only matters once the store has opening hours ("Horarios"). */
export function OutsideHoursCard({ settings }: { settings: StoreSettings }) {
  return (
    <SwitchSettingCard
      settings={settings}
      field="acceptOrdersOutsideHours"
      title="Aceptar pedidos fuera de horario"
      description="Tus clientes pueden pedir con el local cerrado; el pedido se prepara cuando abrís."
      ariaLabel="Aceptar pedidos fuera de horario"
      onAnnouncement="Tus clientes pueden pedir con el local cerrado"
      offAnnouncement="Con el local cerrado, tus clientes solo ven el menú"
    />
  );
}

const SETTINGS_CARD_MESSAGES = {
  saved: "Cambios guardados",
  saveFailed: "No pudimos guardar los cambios. Probá de nuevo.",
  incompleteTransferWarning: "Completá el alias y el titular para que tus clientes sepan dónde transferir.",
  splitDisabled: "Se desactivó Dividir pago porque deshabilitaste Efectivo o Transferencia.",
} as const;

/**
 * Draft and save of one settings card. The draft holds the card's own fields; the rest come from the
 * saved settings, so the PATCH carries only this card's changes.
 */
function useSettingsSection<S extends SettingsSection>(section: S, settings: StoreSettings) {
  const update = useUpdateStoreSettings();
  const [status, setStatus] = useState<"saved" | "error" | "splitDisabled" | null>(null);
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
      setStatus(updated.splitDisabled ? "splitDisabled" : "saved");
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
function SaveRow({ status, canSave }: { status: "saved" | "error" | "splitDisabled" | null; canSave: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="min-w-0" aria-live="polite">
          {status === "saved" && <Notice tone="success">{SETTINGS_CARD_MESSAGES.saved}</Notice>}
          {status === "splitDisabled" && <Notice tone="warning">{SETTINGS_CARD_MESSAGES.splitDisabled}</Notice>}
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
    <SectionCard title="Métodos de pago" description="Tildá los que aceptás. Tus clientes solo ven estos al hacer el pedido.">
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          {check.hasIncompleteTransferWarning && (
            <Notice tone="warning">{SETTINGS_CARD_MESSAGES.incompleteTransferWarning}</Notice>
          )}

          <ul className="m-0 list-none overflow-hidden rounded-xl border border-line p-0">
            <li className="flex min-h-[56px] items-center gap-3 bg-primary-soft px-4">
              <input
                id="payment-cash"
                type="checkbox"
                checked={draft.cashEnabled}
                onChange={(e) => change("cashEnabled", e.target.checked)}
                className="size-5 cursor-pointer rounded border-line accent-primary"
              />
              <label htmlFor="payment-cash" className="flex flex-1 cursor-pointer flex-col gap-0.5">
                <span className="text-sm font-bold">Efectivo</span>
                <span className="text-xs text-muted">El cliente puede decir con cuánto abona</span>
              </label>
            </li>

            <li className="flex flex-col gap-3 border-t border-line/60 bg-primary-soft px-4 py-3.5">
              <span className="flex items-center gap-3">
                <input
                  id="payment-transfer"
                  type="checkbox"
                  checked={draft.transferEnabled}
                  onChange={(e) => change("transferEnabled", e.target.checked)}
                  className="size-5 cursor-pointer rounded border-line accent-primary"
                />
                <label htmlFor="payment-transfer" className="cursor-pointer text-sm font-bold">
                  Transferencia
                </label>
              </span>
              {draft.transferEnabled && (
                <div className="ml-8 flex flex-col gap-3">
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
            </li>

            <li className="flex min-h-[64px] items-center gap-3 border-t border-line/60 bg-primary-soft px-4 py-2">
              <input
                id="payment-split"
                type="checkbox"
                checked={draft.splitEnabled}
                onChange={(e) => change("splitEnabled", e.target.checked)}
                className="size-5 cursor-pointer rounded border-line accent-primary"
              />
              <label htmlFor="payment-split" className="flex flex-1 cursor-pointer flex-col gap-0.5">
                <span className="text-sm font-bold">Dividir pago</span>
                <span className="text-xs text-muted">
                  Una parte en efectivo y el resto por transferencia. Necesita Efectivo y Transferencia habilitados.
                </span>
              </label>
            </li>
          </ul>

          {check.errors.methods && <p className="m-0 text-[13px] text-danger">{check.errors.methods}</p>}

          {draft.cashEnabled || draft.transferEnabled ? (
            <p className="m-0 text-xs text-muted">
              Si destildás Efectivo o Transferencia, Dividir pago se desactiva solo y te lo avisamos al guardar.
            </p>
          ) : (
            <p className="m-0 text-xs text-danger">Tiene que quedar habilitado al menos Efectivo o Transferencia.</p>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-muted">Próximamente</span>
            <ul className="m-0 list-none overflow-hidden rounded-xl border border-line bg-bg/50 p-0">
              {UPCOMING_PAYMENT_METHODS.map((method) => (
                <li
                  key={method.id}
                  aria-disabled="true"
                  className="flex min-h-[52px] items-center gap-3 border-t border-line/60 px-4 text-sm text-muted first:border-t-0"
                >
                  <span aria-hidden="true" className="size-[22px] flex-none rounded-md border-2 border-line-strong bg-bg" />
                  <span className="flex-1">{method.label}</span>
                  <span className="rounded-full border border-line bg-bg px-2.5 py-1 text-xs font-bold">Próximamente</span>
                </li>
              ))}
            </ul>
            <span className="text-xs text-muted">Todavía no se pueden habilitar. Te avisamos cuando estén.</span>
          </div>
        </div>

        <SaveRow status={status} canSave={canSave} />
      </form>
    </SectionCard>
  );
}
