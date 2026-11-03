import { useState } from "react";
import { Notice } from "@/components/AuthLayout";
import { FormField } from "@/components/FormField";
import { QueryError } from "@/components/QueryError";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  checkSettings,
  useStoreSettings,
  useUpdateStoreSettings,
  valuesFromSettings,
  type StoreSettings,
  type StoreSettingsValues,
} from "@/lib/settings";

const SETTINGS_LOAD_MESSAGES = {
  loadFailed: "No pudimos cargar la configuración.",
} as const;

export function StoreSettingsForm() {
  const { data: settings, isError, isRefetching, refetch } = useStoreSettings();

  if (!settings) {
    return isError ? (
      <QueryError message={SETTINGS_LOAD_MESSAGES.loadFailed} onRetry={() => void refetch()} retrying={isRefetching} />
    ) : null;
  }

  return (
    <>
      <ReceptionCard settings={settings} />
      <PaymentsShippingCard key={JSON.stringify(settings)} settings={settings} />
    </>
  );
}

const RECEPTION_MESSAGES = {
  activeAnnouncement: "Tu local vuelve a recibir pedidos",
  pausedAnnouncement: "Tu local ya no recibe pedidos",
  saveFailed: "No pudimos guardar el cambio. Probá de nuevo.",
} as const;

/** Container: saves the switch with an optimistic value that reverts when the save fails. */
function ReceptionCard({ settings }: { settings: StoreSettings }) {
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

function PaymentsShippingCard({ settings }: { settings: StoreSettings }) {
  const update = useUpdateStoreSettings();
  const [status, setStatus] = useState<"saved" | "error" | null>(null);

  const [form, setForm] = useState<StoreSettingsValues>(() => valuesFromSettings(settings));

  const check = checkSettings(settings, form);

  function handleChange(field: keyof StoreSettingsValues, value: string | boolean) {
    setStatus(null);
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!check.changes || check.invalid) return;

    setStatus(null);
    try {
      await update.mutateAsync(check.changes);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <SectionCard title="Pagos y envío">
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Pedido mínimo"
            prefix="$"
            inputMode="numeric"
            value={form.minOrder}
            onChange={(e) => handleChange("minOrder", e.target.value)}
            hint="Dejalo vacío si no hay pedido mínimo."
            error={check.errors.minOrder}
          />
          <FormField
            label="Costo de envío"
            prefix="$"
            inputMode="numeric"
            value={form.shipping}
            onChange={(e) => handleChange("shipping", e.target.value)}
            hint="Solo se suma en pedidos con envío a domicilio."
            error={check.errors.shipping}
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <span className="text-[13px] font-bold">Formas de pago que aceptás</span>

          {check.hasIncompleteTransferWarning && (
            <Notice tone="warning">{SETTINGS_CARD_MESSAGES.incompleteTransferWarning}</Notice>
          )}

          <div className="flex flex-col gap-3">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={form.cashEnabled}
                onChange={(e) => handleChange("cashEnabled", e.target.checked)}
                className="size-5 cursor-pointer rounded border-line accent-primary"
              />
              <span className="text-sm font-semibold">Efectivo</span>
            </label>

            <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={form.transferEnabled}
                onChange={(e) => handleChange("transferEnabled", e.target.checked)}
                className="size-5 cursor-pointer rounded border-line accent-primary"
              />
              <span className="text-sm font-semibold">Transferencia</span>
            </label>
          </div>

          {check.errors.methods && <p className="m-0 text-[13px] text-danger">{check.errors.methods}</p>}

          {form.transferEnabled && (
            <div className="mt-2 flex flex-col gap-3 rounded-xl border border-line bg-bg/50 p-3.5 sm:p-4">
              <FormField
                label="Alias"
                placeholder="ej: marta.hamburguesas"
                value={form.transferAlias}
                onChange={(e) => handleChange("transferAlias", e.target.value)}
                error={check.errors.transferAlias}
              />
              <FormField
                label="Titular de la cuenta"
                placeholder="ej: Marta Gómez"
                value={form.transferHolderName}
                onChange={(e) => handleChange("transferHolderName", e.target.value)}
                error={check.errors.transferHolderName}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="min-w-0" aria-live="polite">
            {status === "saved" && <Notice tone="success">{SETTINGS_CARD_MESSAGES.saved}</Notice>}
          </div>
          <Button
            type="submit"
            className="min-h-12 rounded-xl px-[26px] text-[15px]"
            disabled={!check.changes || check.invalid || update.isPending}
          >
            Guardar cambios
          </Button>
        </div>
        {status === "error" && <Notice tone="error">{SETTINGS_CARD_MESSAGES.saveFailed}</Notice>}
      </form>
    </SectionCard>
  );
}
