import { useRef, useState } from "react";
import { hasCoordinates, type PlaceSuggestion } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { FormField } from "@/components/FormField";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/restaurant";
import { getPlace, searchPlaces, useUpdateStoreLocation, type StoreLocation } from "@/lib/zones";

const ADDRESS_MESSAGES = {
  noAddress: "Todavía no cargaste la dirección de tu local.",
  noResults: "No encontramos esa dirección. Probá con calle, número y localidad.",
  searchFailed: "No pudimos buscar la dirección. Probá de nuevo.",
  saveFailed: "No pudimos guardar la dirección. Probá de nuevo.",
  saved: "Dirección guardada",
  notesSaved: "Instrucciones guardadas",
} as const;

/** The API message when it is meant for the owner (validation, maps unavailable), else `fallback`. */
function messageOf(error: unknown, fallback: string): string {
  if (error instanceof ApiError && (error.code === "VALIDATION_ERROR" || error.code === "MAPS_UNAVAILABLE" || error.code === "PLACE_NOT_FOUND")) {
    return error.message;
  }
  return fallback;
}

type AddressStatus = { tone: "success" | "error"; text: string } | null;

/**
 * "Dirección del local": search (one Google session per search, closed when a suggestion is picked),
 * pick, save; plus the instructions for the delivery person.
 */
export function StoreAddressCard({ location }: { location: StoreLocation }) {
  const update = useUpdateStoreLocation();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<AddressStatus>(null);
  const [notes, setNotes] = useState(location.addressNotes ?? "");
  // One UUID per search flow: autocomplete calls and the details of the chosen place share it.
  const session = useRef<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    session.current ??= crypto.randomUUID();
    setSearching(true);
    setStatus(null);
    try {
      const found = await searchPlaces(q, session.current);
      setSuggestions(found);
      if (found.length === 0) setStatus({ tone: "error", text: ADDRESS_MESSAGES.noResults });
    } catch (error) {
      setSuggestions(null);
      setStatus({ tone: "error", text: messageOf(error, ADDRESS_MESSAGES.searchFailed) });
    } finally {
      setSearching(false);
    }
  }

  async function handlePick(suggestion: PlaceSuggestion) {
    const token = session.current ?? crypto.randomUUID();
    session.current = null;
    setSearching(true);
    setStatus(null);
    try {
      const place = await getPlace(suggestion.placeId, token);
      await update.mutateAsync({
        ...location,
        address: place.formattedAddress,
        lat: place.lat,
        lng: place.lng,
        placeId: place.placeId,
      });
      setSuggestions(null);
      setQuery("");
      setStatus({ tone: "success", text: ADDRESS_MESSAGES.saved });
    } catch (error) {
      setStatus({ tone: "error", text: messageOf(error, ADDRESS_MESSAGES.saveFailed) });
    } finally {
      setSearching(false);
    }
  }

  async function handleNotes(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      const saved = await update.mutateAsync({ ...location, addressNotes: notes });
      setNotes(saved.addressNotes ?? "");
      setStatus({ tone: "success", text: ADDRESS_MESSAGES.notesSaved });
    } catch (error) {
      setStatus({ tone: "error", text: messageOf(error, ADDRESS_MESSAGES.saveFailed) });
    }
  }

  const busy = searching || update.isPending;
  const notesChanged = notes.trim() !== (location.addressNotes ?? "");

  return (
    <SectionCard title="Dirección del local" description="Desde acá se miden las zonas de entrega.">
      <p className="m-0 flex items-start gap-2 text-sm">
        <PinIcon />
        {location.address ? <b className="min-w-0">{location.address}</b> : <span className="text-muted">{ADDRESS_MESSAGES.noAddress}</span>}
      </p>

      <form noValidate onSubmit={handleSearch} className="flex flex-col gap-1.5" role="search">
        <label htmlFor="store-address-search" className="text-[13px] font-bold">
          {location.address ? "Cambiar dirección" : "Buscar dirección"}
        </label>
        <div className="flex gap-2">
          <Input
            id="store-address-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ej: Av. Corrientes 1234, CABA"
            autoComplete="off"
            maxLength={200}
          />
          <Button type="submit" variant="outline" className="shrink-0 px-5" disabled={busy || !query.trim()}>
            Buscar
          </Button>
        </div>
      </form>

      {suggestions && suggestions.length > 0 && (
        <ul aria-label="Direcciones encontradas" className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-line p-0">
          {suggestions.map((suggestion) => (
            <li key={suggestion.placeId} className="border-b border-line-soft last:border-b-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handlePick(suggestion)}
                className="flex min-h-12 w-full cursor-pointer flex-col items-start gap-0.5 px-3.5 py-2.5 text-left hover:bg-bg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:cursor-wait"
              >
                <span className="text-sm font-semibold">{suggestion.mainText}</span>
                {suggestion.secondaryText && <span className="text-xs text-muted">{suggestion.secondaryText}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form noValidate onSubmit={handleNotes} className="flex flex-col gap-3">
        <FormField
          label="Instrucciones"
          placeholder="ej: Timbre 2B, entrada por el costado"
          value={notes}
          maxLength={200}
          onChange={(e) => {
            setStatus(null);
            setNotes(e.target.value);
          }}
          hint="Opcional. Ayudan a encontrar el local."
        />
        {notesChanged && (
          <Button type="submit" variant="outline" className="self-end px-5" disabled={busy}>
            Guardar instrucciones
          </Button>
        )}
      </form>

      <div aria-live="polite">{status && <Notice tone={status.tone}>{status.text}</Notice>}</div>
    </SectionCard>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mt-px size-5 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

const MODE_MESSAGES = {
  needsAddress: "Cargá la dirección del local para usar zonas.",
  saveFailed: "No pudimos cambiar el modo. Probá de nuevo.",
} as const;

/** "Modo": flat price (off) or priced by zones drawn on the map (on). Zones need the store location. */
export function DeliveryModeCard({ location }: { location: StoreLocation }) {
  const update = useUpdateStoreLocation();
  const [error, setError] = useState<string | null>(null);
  const located = hasCoordinates(location);

  async function handleToggle(next: boolean) {
    setError(null);
    try {
      await update.mutateAsync({ ...location, deliveryMode: next ? "zones" : "flat" });
    } catch (e) {
      setError(messageOf(e, MODE_MESSAGES.saveFailed));
    }
  }

  return (
    <SectionCard
      title="Usar zonas con Google Maps"
      description="Cobrá el envío según dónde está tu cliente. Apagado, se cobra el mismo costo a todos."
      action={
        <Switch
          checked={location.deliveryMode === "zones"}
          onCheckedChange={(next) => void handleToggle(next)}
          disabled={update.isPending || (!located && location.deliveryMode === "flat")}
          aria-label="Usar zonas con Google Maps"
        />
      }
      actionAlign="center"
    >
      {!located && <Notice tone="info">{MODE_MESSAGES.needsAddress}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </SectionCard>
  );
}
