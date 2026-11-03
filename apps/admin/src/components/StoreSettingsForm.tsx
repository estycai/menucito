import { useId, useState } from "react";
import { Notice } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import {
  checkSettings,
  useStoreSettings,
  useUpdateStoreSettings,
  valuesFromSettings,
  type StoreSettingsValues,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

export function StoreSettingsForm() {
  const { data: settings, isLoading } = useStoreSettings();

  if (isLoading || !settings) {
    return null;
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

function ReceptionCard({ settings }: { settings: NonNullable<ReturnType<typeof useStoreSettings>["data"]> }) {
  const id = useId();
  const update = useUpdateStoreSettings();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accepting = optimistic ?? settings.acceptingOrders;

  async function handleToggle() {
    const next = !accepting;
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
    <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-white p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={`${id}-title`} className="m-0 font-display text-xl font-extrabold">
            Recepción de pedidos
          </h2>
          <p className="m-0 text-[13px] text-muted">
            Pausá la recepción cuando no puedas tomar pedidos. Tu menú sigue visible para tus clientes.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={accepting}
          aria-label="Recibir pedidos"
          disabled={update.isPending}
          onClick={handleToggle}
          className={cn(
            "relative inline-flex min-h-[44px] w-14 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent p-0.5 transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            accepting ? "bg-success" : "bg-[#d6d3d1]",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none inline-block size-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out",
              accepting ? "translate-x-7" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}

const SETTINGS_CARD_MESSAGES = {
  saved: "Cambios guardados",
  saveFailed: "No pudimos guardar los cambios. Probá de nuevo.",
  incompleteTransferWarning: "Completá el alias y el titular para que tus clientes sepan dónde transferir.",
} as const;

function PaymentsShippingCard({ settings }: { settings: NonNullable<ReturnType<typeof useStoreSettings>["data"]> }) {
  const id = useId();
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

  const minOrderId = `${id}-min-order`;
  const shippingId = `${id}-shipping`;
  const aliasId = `${id}-transfer-alias`;
  const holderId = `${id}-transfer-holder`;

  return (
    <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-white p-4 sm:p-6">
      <h2 id={`${id}-title`} className="m-0 font-display text-xl font-extrabold">
        Pagos y envío
      </h2>

      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Min Order & Shipping */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={minOrderId} className="text-[13px] font-bold">
              Pedido mínimo
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">$</span>
              <input
                id={minOrderId}
                type="text"
                inputMode="numeric"
                value={form.minOrder}
                onChange={(e) => handleChange("minOrder", e.target.value)}
                aria-invalid={check.errors.minOrder ? true : undefined}
                aria-describedby={[`${minOrderId}-help`, check.errors.minOrder && `${minOrderId}-error`].filter(Boolean).join(" ")}
                className="box-border min-h-[44px] w-full rounded-xl border border-line bg-white pl-8 pr-3.5 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-danger"
              />
            </div>
            <span id={`${minOrderId}-help`} className="text-xs text-muted">
              Dejalo vacío si no hay pedido mínimo.
            </span>
            {check.errors.minOrder && (
              <p id={`${minOrderId}-error`} className="m-0 text-[13px] text-danger">
                {check.errors.minOrder}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={shippingId} className="text-[13px] font-bold">
              Costo de envío
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">$</span>
              <input
                id={shippingId}
                type="text"
                inputMode="numeric"
                value={form.shipping}
                onChange={(e) => handleChange("shipping", e.target.value)}
                aria-invalid={check.errors.shipping ? true : undefined}
                aria-describedby={[`${shippingId}-help`, check.errors.shipping && `${shippingId}-error`].filter(Boolean).join(" ")}
                className="box-border min-h-[44px] w-full rounded-xl border border-line bg-white pl-8 pr-3.5 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-danger"
              />
            </div>
            <span id={`${shippingId}-help`} className="text-xs text-muted">
              Solo se suma en pedidos con envío a domicilio.
            </span>
            {check.errors.shipping && (
              <p id={`${shippingId}-error`} className="m-0 text-[13px] text-danger">
                {check.errors.shipping}
              </p>
            )}
          </div>
        </div>

        {/* Payment Methods */}
        <div className="flex flex-col gap-3 border-t border-[#f0ece6] pt-4">
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

          {check.errors.methods && (
            <p className="m-0 text-[13px] text-danger">{check.errors.methods}</p>
          )}

          {form.transferEnabled && (
            <div className="mt-2 flex flex-col gap-3 rounded-xl border border-line bg-bg/50 p-3.5 sm:p-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={aliasId} className="text-[13px] font-bold">
                  Alias
                </label>
                <input
                  id={aliasId}
                  type="text"
                  placeholder="ej: marta.hamburguesas"
                  value={form.transferAlias}
                  onChange={(e) => handleChange("transferAlias", e.target.value)}
                  aria-invalid={check.errors.transferAlias ? true : undefined}
                  aria-describedby={check.errors.transferAlias ? `${aliasId}-error` : undefined}
                  className="box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3.5 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-danger"
                />
                {check.errors.transferAlias && (
                  <p id={`${aliasId}-error`} className="m-0 text-[13px] text-danger">
                    {check.errors.transferAlias}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor={holderId} className="text-[13px] font-bold">
                  Titular de la cuenta
                </label>
                <input
                  id={holderId}
                  type="text"
                  placeholder="ej: Marta Gómez"
                  value={form.transferHolderName}
                  onChange={(e) => handleChange("transferHolderName", e.target.value)}
                  aria-invalid={check.errors.transferHolderName ? true : undefined}
                  aria-describedby={check.errors.transferHolderName ? `${holderId}-error` : undefined}
                  className="box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3.5 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-danger"
                />
                {check.errors.transferHolderName && (
                  <p id={`${holderId}-error`} className="m-0 text-[13px] text-danger">
                    {check.errors.transferHolderName}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Submit button & feedback */}
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
    </section>
  );
}
