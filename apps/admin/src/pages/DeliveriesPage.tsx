import { useState } from "react";
import { formatArs, formatLocalTime, type CourierDelivery } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { QueryError } from "@/components/QueryError";
import { Button } from "@/components/ui/button";
import {
  DELIVERIES_UI_MESSAGES,
  directionsUrl,
  isDeliveryGoneError,
  mapsUrlForDelivery,
  sortDeliveriesByProximity,
  todayAndTomorrowRange,
  todayRange,
  useCourierStoreLocation,
  useDeliveries,
  useDeliveriesSummary,
  useMarkDelivered,
  type DateRange,
} from "@/lib/deliveries";
import { useMyRestaurant } from "@/lib/restaurant";
import { useDocumentTitle } from "@/lib/use-document-title";
import { cn } from "@/lib/utils";

const CONTROL_CLASS =
  "box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

type Preset = "today" | "tomorrow" | "custom";

/**
 * "Mis repartos" (change 13, scenarios 44-47): the courier's orders on the way, ordered by proximity,
 * with a one-tap delivery and the day's numbers. Reachable with the `is_courier` mark (`RequireCourier`).
 */
export function DeliveriesPage() {
  useDocumentTitle("Mis repartos");
  const { data: restaurant } = useMyRestaurant();
  const [preset, setPreset] = useState<Preset>("today");
  const [range, setRange] = useState<DateRange>(() => todayRange());
  const [confirming, setConfirming] = useState<CourierDelivery | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; text: string } | null>(null);

  const deliveriesQuery = useDeliveries();
  const summaryQuery = useDeliveriesSummary(range);
  // A courier's role may have no `store.view`, so the store point comes from the public menu.
  const storeQuery = useCourierStoreLocation(restaurant?.slug);
  const markDelivered = useMarkDelivered();

  const store = storeQuery.data ?? null;
  const deliveries = deliveriesQuery.data ?? [];
  const ordered = sortDeliveriesByProximity(store, deliveries);
  const routeUrl = directionsUrl(store, ordered);
  const summary = summaryQuery.data;

  function applyPreset(next: Exclude<Preset, "custom">) {
    setPreset(next);
    setRange(next === "today" ? todayRange() : todayAndTomorrowRange());
  }

  function handleConfirmDelivered() {
    if (!confirming) return;
    const order = confirming;
    markDelivered.mutate(order.id, {
      onSuccess: () => {
        setConfirming(null);
        setNotice({ tone: "success", text: `Pedido #${order.number} entregado.` });
      },
      onError: (error) => {
        if (!isDeliveryGoneError(error)) return;
        setConfirming(null);
        setNotice({
          tone: "warning",
          text: `El pedido #${order.number} ${DELIVERIES_UI_MESSAGES.deliverGone}`,
        });
      },
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
      <h1 className="m-0 font-display text-[26px] font-extrabold sm:text-[32px]">Mis repartos</h1>

      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Desde
            <input
              type="date"
              value={range.from}
              onChange={(event) => {
                if (!event.target.value) return;
                setPreset("custom");
                setRange((prev) => ({ ...prev, from: event.target.value }));
              }}
              className={CONTROL_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Hasta
            <input
              type="date"
              value={range.to}
              onChange={(event) => {
                if (!event.target.value) return;
                setPreset("custom");
                setRange((prev) => ({ ...prev, to: event.target.value }));
              }}
              className={CONTROL_CLASS}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <PresetButton selected={preset === "today"} onClick={() => applyPreset("today")}>
            Hoy
          </PresetButton>
          <PresetButton selected={preset === "tomorrow"} onClick={() => applyPreset("tomorrow")}>
            Hoy y mañana
          </PresetButton>
        </div>

        {summaryQuery.isError ? (
          <QueryError message={DELIVERIES_UI_MESSAGES.summaryLoadFailed} onRetry={() => void summaryQuery.refetch()} />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <SummaryNumber label="Entregados" value={summary ? String(summary.delivered) : "—"} />
            <SummaryNumber label="Envíos" value={summary ? formatArs(summary.shippingCents) : "—"} />
            <SummaryNumber label="Propinas" value={summary ? formatArs(summary.tipCents) : "—"} tone="success" />
          </div>
        )}
      </section>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {deliveriesQuery.isError && deliveries.length === 0 && (
        <QueryError message={DELIVERIES_UI_MESSAGES.listLoadFailed} onRetry={() => void deliveriesQuery.refetch()} />
      )}
      {deliveriesQuery.isRefetchError && deliveries.length > 0 && (
        <QueryError message={DELIVERIES_UI_MESSAGES.listRefreshFailed} onRetry={() => void deliveriesQuery.refetch()} compact />
      )}
      {deliveriesQuery.isLoading && <p className="m-0 text-sm text-muted">Cargando tus repartos...</p>}

      {routeUrl && (
        <a
          href={routeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[56px] items-center justify-center gap-2.5 rounded-2xl bg-info px-4 text-[17px] font-extrabold text-white transition-colors hover:bg-info/90"
        >
          <RouteIcon />
          Ver ruta en Maps
        </a>
      )}

      {!deliveriesQuery.isLoading && !deliveriesQuery.isError && ordered.length > 0 && (
        <h2 className="m-0 text-sm font-bold text-muted">En camino ({ordered.length}) · ordenados por cercanía</h2>
      )}

      <div className="flex flex-col gap-3">
        {ordered.map((delivery, index) => (
          <DeliveryCard
            key={delivery.id}
            delivery={delivery}
            position={index + 1}
            onDeliver={() => {
              markDelivered.reset();
              setConfirming(delivery);
            }}
          />
        ))}
      </div>

      {!deliveriesQuery.isLoading && !deliveriesQuery.isError && ordered.length === 0 && (
        <section className="mx-auto mt-8 flex max-w-[320px] flex-col items-center gap-3 text-center">
          <span aria-hidden="true" className="flex size-[72px] items-center justify-center rounded-full bg-tab text-muted">
            <MopedIcon />
          </span>
          <p className="m-0 font-display text-[22px] font-extrabold">{DELIVERIES_UI_MESSAGES.empty}</p>
          <p className="m-0 text-[15px] text-muted">{DELIVERIES_UI_MESSAGES.emptyHint}</p>
        </section>
      )}

      {confirming && (
        <ConfirmDialog
          title={`¿Entregaste el pedido #${confirming.number}?`}
          confirmLabel="Sí, entregado"
          pending={markDelivered.isPending}
          error={markDelivered.isError ? DELIVERIES_UI_MESSAGES.deliverFailed : null}
          onConfirm={handleConfirmDelivered}
          onCancel={() => setConfirming(null)}
        >
          {confirming.paymentMethod === "cash" ? (
            <>
              <span className="flex items-center justify-between gap-3 rounded-xl bg-warning-soft px-3.5 py-3">
                <span className="text-[15px] font-bold text-warning">Cobraste en efectivo</span>
                <span className="font-display text-2xl font-extrabold text-warning">{formatArs(confirming.totalCents)}</span>
              </span>
              <span className="mt-3 block text-sm text-muted">El pedido queda entregado y pagado.</span>
            </>
          ) : (
            <>
              <span className="flex items-center justify-between gap-3 rounded-xl bg-success-soft px-3.5 py-3">
                <span className="text-[15px] font-bold text-success">Ya estaba pagado</span>
                {confirming.tipCents > 0 && (
                  <span className="font-display text-2xl font-extrabold text-success">{formatArs(confirming.tipCents)}</span>
                )}
              </span>
              <span className="mt-3 block text-sm text-muted">El pedido queda entregado.</span>
            </>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

function PresetButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "min-h-10 cursor-pointer rounded-full px-3.5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
        selected ? "border-2 border-primary bg-primary-soft text-link" : "border border-line-strong bg-white text-ink",
      )}
    >
      {children}
    </button>
  );
}

function SummaryNumber({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className={cn("font-display text-xl font-extrabold", tone === "success" && "text-success")}>{value}</span>
    </span>
  );
}

/** One stop of the route: numbering, address, notes and the payment line plus the two actions. */
function DeliveryCard({
  delivery,
  position,
  onDeliver,
}: {
  delivery: CourierDelivery;
  position: number;
  onDeliver: () => void;
}) {
  const mapsUrl = mapsUrlForDelivery(delivery);
  const phone = delivery.customerPhone ? `tel:+${delivery.customerPhone}` : null;
  const locationLine = delivery.deliveryLocation
    ? [delivery.deliveryLocation.unit, delivery.deliveryLocation.betweenStreets].filter(Boolean).join(" · ")
    : "";

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2.5 font-display text-[22px] font-extrabold">
          <span
            aria-label={`Parada ${position}`}
            className="flex size-[30px] items-center justify-center rounded-full bg-info text-base text-white"
          >
            {position}
          </span>
          #{delivery.number} · {delivery.customerName}
        </span>
        {delivery.sentAt !== null && <span className="shrink-0 text-[13px] text-muted">salió {formatLocalTime(delivery.sentAt)}</span>}
      </div>

      <div className="flex flex-col gap-0.5">
        {delivery.deliveryAddress && <span className="text-lg leading-snug font-bold">{delivery.deliveryAddress}</span>}
        {locationLine && <span className="text-sm text-muted">{locationLine}</span>}
        {delivery.notes && (
          <span className="mt-1.5 rounded-lg bg-warning-soft px-2.5 py-1.5 text-sm text-warning">{delivery.notes}</span>
        )}
      </div>

      {delivery.paymentMethod === "cash" ? (
        <div className="flex items-center justify-between rounded-xl bg-warning-soft px-3.5 py-3">
          <span className="text-[15px] font-bold text-warning">Cobrar en efectivo</span>
          <span className="font-display text-2xl font-extrabold text-warning">{formatArs(delivery.totalCents)}</span>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-xl bg-success-soft px-3.5 py-3">
          <span className="text-[15px] font-bold text-success">Ya pagado</span>
          {delivery.tipCents > 0 && (
            <span className="text-[15px] font-bold text-success">Tu propina {formatArs(delivery.tipCents)}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] border border-line-strong text-base font-bold hover:bg-bg"
          >
            <PinIcon />
            Abrir Maps
          </a>
        ) : (
          <span aria-disabled="true" className="flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] border border-line text-base font-bold text-muted opacity-60">
            <PinIcon />
            Abrir Maps
          </span>
        )}
        {phone ? (
          <a
            href={phone}
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] border border-line-strong text-base font-bold hover:bg-bg"
          >
            <PhoneIcon />
            Llamar
          </a>
        ) : (
          <span aria-disabled="true" className="flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] border border-line text-base font-bold text-muted opacity-60">
            <PhoneIcon />
            Llamar
          </span>
        )}
      </div>

      <Button type="button" onClick={onDeliver} className="min-h-[56px] gap-2.5 rounded-2xl bg-success text-[19px] hover:bg-success/90">
        <CheckIcon />
        Entregado
      </Button>
    </article>
  );
}

function RouteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M6 17V9a4 4 0 0 1 4-4h2M18 7v8a4 4 0 0 1-4 4h-2" />
    </svg>
  );
}

function MopedIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="17" r="3" />
      <circle cx="18" cy="17" r="3" />
      <path d="M9 17h6l-3-8h-3M15 9h3l2 5" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}
