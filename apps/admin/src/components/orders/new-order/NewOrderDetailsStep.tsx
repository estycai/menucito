import { useRef, useState, type FormEvent } from "react";
import type { UseFormReturn } from "react-hook-form";
import {
  FULFILLMENT_LABELS,
  ORDER_NOTES_MAX_LENGTH,
  type OrderDelivery,
  type PlaceSuggestion,
  type PublicMenu,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getOrderPlace, searchOrderPlaces } from "@/lib/new-order-api";
import type { NewOrderFormValues } from "@/lib/new-order";
import { ApiError } from "@/lib/restaurant";
import { cn } from "@/lib/utils";

interface NewOrderDetailsStepProps {
  form: UseFormReturn<NewOrderFormValues>;
  menu: PublicMenu;
  delivery: OrderDelivery | null;
  onDeliveryChange: (delivery: OrderDelivery | null) => void;
  onContinue: () => void;
}

const ADDRESS_MESSAGES = {
  noResults: "No encontramos esa dirección. Probá con calle, número y localidad.",
  searchFailed: "No pudimos buscar la dirección. Probá de nuevo.",
} as const;

/** Step 1 of "Nuevo pedido": fulfillment, customer, source and comment. */
export function NewOrderDetailsStep({
  form,
  menu,
  delivery,
  onDeliveryChange,
  onContinue,
}: NewOrderDetailsStepProps) {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = form;
  const fulfillment = watch("fulfillment");
  const source = watch("source");
  const zones = menu.restaurant.deliveryMode === "zones";

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const session = useRef<string | null>(null);

  const offered = [
    ...(menu.restaurant.delivery ? (["delivery"] as const) : []),
    ...(menu.restaurant.takeaway ? (["takeaway"] as const) : []),
  ];

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    session.current ??= crypto.randomUUID();
    setSearching(true);
    setSearchError(null);
    try {
      const found = await searchOrderPlaces(text, session.current);
      setSuggestions(found);
      if (found.length === 0) setSearchError(ADDRESS_MESSAGES.noResults);
    } catch {
      setSuggestions(null);
      setSearchError(ADDRESS_MESSAGES.searchFailed);
    } finally {
      setSearching(false);
    }
  }

  async function handlePick(suggestion: PlaceSuggestion) {
    const token = session.current ?? crypto.randomUUID();
    session.current = null;
    setSearching(true);
    setSearchError(null);
    try {
      const place = await getOrderPlace(suggestion.placeId, token);
      setValue("address", place.formattedAddress, { shouldValidate: true });
      onDeliveryChange({
        placeId: place.placeId,
        lat: place.lat,
        lng: place.lng,
        formattedAddress: place.formattedAddress,
        locality: place.locality,
        unit: null,
        betweenStreets: null,
        label: null,
      });
      setSuggestions(null);
      setQuery("");
    } catch (error) {
      setSearchError(error instanceof ApiError ? error.message : ADDRESS_MESSAGES.searchFailed);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col gap-5 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
      <section className="flex flex-col gap-2">
        <span className="text-xs font-bold text-muted">Modalidad</span>
        <div role="group" aria-label="Modalidad" className="flex gap-2">
          {offered.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={fulfillment === option}
              onClick={() => {
                setValue("fulfillment", option, { shouldValidate: true });
                onDeliveryChange(null);
              }}
              className={cn(
                "min-h-11 flex-1 cursor-pointer rounded-xl border px-4 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                fulfillment === option ? "border-primary bg-primary-soft text-ink" : "border-line bg-white text-ink",
              )}
            >
              {FULFILLMENT_LABELS[option]}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="m-0 text-sm font-extrabold text-ink">Cliente</h3>
        <FormField
          label="Nombre"
          error={errors.customerName?.message}
          autoComplete="off"
          maxLength={60}
          {...register("customerName")}
        />
        <FormField
          label="Teléfono"
          error={errors.customerPhone?.message}
          hint={
            source === "whatsapp"
              ? "Obligatorio para pedidos de WhatsApp."
              : "Opcional. Con código de área, por ejemplo 11 1234-5678."
          }
          inputMode="tel"
          autoComplete="off"
          {...register("customerPhone")}
        />

        {fulfillment === "delivery" &&
          (zones ? (
            <div className="flex flex-col gap-1.5" role="search">
              <span className="text-[13px] font-bold">Dirección</span>
              {delivery && <p className="m-0 text-sm text-ink">{delivery.formattedAddress}</p>}
              <div className="flex gap-2">
                <Input
                  aria-label="Buscar dirección"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="ej: Av. Corrientes 1234, CABA"
                  autoComplete="off"
                  maxLength={200}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={searching || !query.trim()}
                  onClick={(event) => void handleSearch(event)}
                  className="shrink-0 px-4"
                >
                  Buscar
                </Button>
              </div>
              {errors.address && <p className="m-0 text-[13px] text-danger">{errors.address.message}</p>}
              {searchError && <Notice tone="error">{searchError}</Notice>}
              {suggestions && suggestions.length > 0 && (
                <ul
                  aria-label="Direcciones encontradas"
                  className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-line p-0"
                >
                  {suggestions.map((suggestion) => (
                    <li key={suggestion.placeId} className="border-b border-line-soft last:border-b-0">
                      <button
                        type="button"
                        disabled={searching}
                        onClick={() => void handlePick(suggestion)}
                        className="flex min-h-12 w-full cursor-pointer flex-col items-start gap-0.5 px-3.5 py-2.5 text-left hover:bg-bg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                      >
                        <span className="text-sm font-semibold">{suggestion.mainText}</span>
                        {suggestion.secondaryText && (
                          <span className="text-xs text-muted">{suggestion.secondaryText}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input type="hidden" {...register("address")} />
            </div>
          ) : (
            <FormField
              label="Dirección"
              error={errors.address?.message}
              autoComplete="off"
              maxLength={120}
              {...register("address")}
            />
          ))}
      </section>

      <section className="flex flex-col gap-2">
        <span className="text-xs font-bold text-muted">Origen</span>
        <div role="group" aria-label="Origen del pedido" className="flex gap-2">
          {(["whatsapp", "local"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={source === option}
              onClick={() => setValue("source", option, { shouldValidate: true })}
              className={cn(
                "min-h-11 flex-1 cursor-pointer rounded-xl border px-4 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                source === option ? "border-primary bg-primary-soft text-ink" : "border-line bg-white text-ink",
              )}
            >
              {option === "whatsapp" ? "WhatsApp" : "Local"}
            </button>
          ))}
        </div>
      </section>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-bold">Comentarios</span>
        <textarea
          {...register("notes")}
          rows={2}
          maxLength={ORDER_NOTES_MAX_LENGTH}
          placeholder="ej: tocar timbre 2B, sin servilletas"
          className="box-border w-full resize-y rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        {errors.notes && <p className="m-0 text-[13px] text-danger">{errors.notes.message}</p>}
      </label>

      <Button type="button" onClick={onContinue} className="min-h-12 w-full text-sm font-bold">
        Continuar
      </Button>
    </div>
  );
}
