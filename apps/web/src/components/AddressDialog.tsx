import { useEffect, useRef, useState } from "preact/hooks";
import {
  ADDRESS_LABELS,
  ADDRESS_LABEL_TEXT,
  BETWEEN_STREETS_MAX_LENGTH,
  DELIVERY_UNIT_MAX_LENGTH,
  LOCATION_MESSAGES,
  PLACE_QUERY_MAX_LENGTH,
  type AddressLabel,
  type LatLng,
  type OrderDelivery,
  type PlaceResult,
  type PlaceSuggestion,
} from "@menucito/shared";
import {
  ADDRESS_SEARCH_MESSAGES,
  addressLines,
  addressSearchErrorMessage,
  getPlace,
  highlightSegments,
  reversePlace,
  sameSpot,
  searchPlaces,
  toOrderDelivery,
} from "../lib/delivery-address";
import { newToken } from "../lib/order-attempt";
import { useModalDialog } from "../lib/use-modal-dialog";
import { AddressMap } from "./AddressMap";
import { useBackdropClose } from "../lib/backdrop-close";

interface AddressDialogProps {
  apiUrl: string;
  slug: string;
  /** The store, where the map opens when there is no address yet. */
  origin: LatLng;
  /** The address confirmed before, if any: the map opens on it and its details are kept. */
  initial: OrderDelivery | null;
  /** Called for every way of closing, including Escape. Idempotent. */
  onClose: () => void;
  onConfirm: (address: OrderDelivery) => void;
}

/**
 * - `search`: street and number, then up to 5 Google results;
 * - `map`: drag the map under a fixed pin when the address is not found;
 * - `details`: the chosen address plus label, cross streets and floor.
 */
type View = "search" | "map" | "details";

type PinState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; place: PlaceResult }
  | { status: "error"; message: string };

const TITLES: Record<View, string> = {
  search: "Dirección de entrega",
  map: "Ubicá tu dirección en el mapa",
  details: "Tu dirección",
};

/**
 * Address picker of stores in `zones` mode, on a native modal `<dialog>` (like the ingredient sheet).
 * One Google session token covers a search flow: the autocomplete calls and the details of the chosen
 * result; a new flow starts after a result is resolved.
 */
export function AddressDialog({ apiUrl, slug, origin, initial, onClose, onConfirm }: AddressDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const session = useRef(newToken());
  useModalDialog(dialogRef);

  const [view, setView] = useState<View>("search");
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [results, setResults] = useState<PlaceSuggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [place, setPlace] = useState<PlaceResult | null>(null);
  const [pin, setPin] = useState<PinState>({ status: "idle" });
  const [mapFailed, setMapFailed] = useState(false);
  const lastReversed = useRef<LatLng | null>(null);
  const reverseSeq = useRef(0);

  const [label, setLabel] = useState<AddressLabel | null>(initial?.label ?? null);
  const [betweenStreets, setBetweenStreets] = useState(initial?.betweenStreets ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "");

  // Each view announces itself: focus moves to its title (the first render keeps the browser's focus
  // on the search input).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    titleRef.current?.focus();
  }, [view]);

  const close = () => {
    dialogRef.current?.close();
    onClose();
  };

  const search = async (event: Event) => {
    event.preventDefault();
    const text = query.trim();
    if (!text) {
      setSearchError(LOCATION_MESSAGES.placeQueryRequired);
      return;
    }
    setBusy(true);
    setSearchError("");
    const result = await searchPlaces(apiUrl, slug, text, session.current);
    setBusy(false);
    if (!result.ok) {
      setResults(null);
      setSearchError(addressSearchErrorMessage(result.code));
      return;
    }
    setSearchedQuery(text);
    setResults(result.data);
  };

  const choose = async (suggestion: PlaceSuggestion) => {
    setBusy(true);
    setSearchError("");
    const result = await getPlace(apiUrl, slug, suggestion.placeId, session.current);
    setBusy(false);
    if (!result.ok) {
      setSearchError(addressSearchErrorMessage(result.code));
      return;
    }
    // The details call closed this search session; the next search starts a new one.
    session.current = newToken();
    setPlace(result.data);
    setView("details");
  };

  const reverse = async (point: LatLng) => {
    if (sameSpot(lastReversed.current, point)) return;
    lastReversed.current = point;
    const seq = ++reverseSeq.current;
    setPin({ status: "loading" });
    const result = await reversePlace(apiUrl, slug, point);
    // Only the answer for the latest map position counts.
    if (seq !== reverseSeq.current) return;
    if (result.ok) setPin({ status: "ready", place: result.data });
    else {
      setPin({
        status: "error",
        message: result.code === "PLACE_NOT_FOUND" ? ADDRESS_SEARCH_MESSAGES.pinNotFound : addressSearchErrorMessage(result.code),
      });
    }
  };

  const openMap = () => {
    lastReversed.current = null;
    setPin({ status: "idle" });
    setMapFailed(false);
    setView("map");
  };

  const confirmPin = () => {
    if (pin.status !== "ready") return;
    setPlace(pin.place);
    setView("details");
  };

  const confirm = () => {
    if (!place) return;
    onConfirm(toOrderDelivery(place, { label, betweenStreets, unit }));
    close();
  };

  const mapCenter: LatLng = place ?? initial ?? origin;
  const titleId = "address-dialog-title";

  const backdropClose = useBackdropClose(close);
  return (
    <dialog
      ref={dialogRef}
      class="sheet address-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      {...backdropClose}
    >
      <div class="sheet-panel">
        <header class="sheet-header">
          <h2 class="sheet-title" id={titleId} ref={titleRef} tabIndex={-1}>
            {TITLES[view]}
          </h2>
          <button type="button" class="icon-button" aria-label="Cerrar" onClick={close}>
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        {view === "search" && (
          <>
            <form class="address-search" noValidate onSubmit={search}>
              <div class="field">
                <label for="address-query">Calle y número</label>
                <input
                  id="address-query"
                  type="text"
                  autoComplete="street-address"
                  maxLength={PLACE_QUERY_MAX_LENGTH}
                  value={query}
                  aria-invalid={searchError ? "true" : undefined}
                  aria-describedby="address-search-error"
                  onInput={(event) => setQuery(event.currentTarget.value)}
                />
              </div>
              <button type="submit" class="primary-button" disabled={busy}>
                {busy ? "Buscando…" : "Buscar dirección"}
              </button>
            </form>

            <p class="field-error" id="address-search-error" aria-live="polite">
              {searchError}
            </p>

            {results && (
              <div class="address-results" aria-live="polite">
                {results.length === 0 ? (
                  <p class="order-status">{ADDRESS_SEARCH_MESSAGES.noResults}</p>
                ) : (
                  <ul class="address-result-list">
                    {results.map((suggestion) => (
                      <li key={suggestion.placeId}>
                        <button type="button" class="address-result" disabled={busy} onClick={() => void choose(suggestion)}>
                          <span class="address-result-main">
                            {highlightSegments(suggestion.mainText, searchedQuery).map((segment, i) =>
                              segment.match ? <mark key={i}>{segment.text}</mark> : <span key={i}>{segment.text}</span>,
                            )}
                          </span>
                          {suggestion.secondaryText && <span class="address-result-secondary">{suggestion.secondaryText}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p class="address-attribution">Resultados de Google Maps</p>
              </div>
            )}

            <button type="button" class="link-button address-map-link" onClick={openMap}>
              ¿No encontrás tu dirección? Ubicala en el mapa
            </button>
          </>
        )}

        {view === "map" && (
          <>
            {mapFailed ? (
              <p class="field-error" role="alert">
                {ADDRESS_SEARCH_MESSAGES.mapFailed}
              </p>
            ) : (
              <>
                <AddressMap center={mapCenter} onIdle={(point) => void reverse(point)} onError={() => setMapFailed(true)} />
                <div class="address-card" aria-live="polite" aria-busy={pin.status === "ready" ? undefined : "true"}>
                  {pin.status === "ready" ? (
                    <AddressLines address={pin.place} />
                  ) : pin.status === "error" ? (
                    <span class="field-error">{pin.message}</span>
                  ) : (
                    <span class="address-card-loading">
                      <span class="spinner" aria-hidden="true" /> Buscando la dirección…
                    </span>
                  )}
                </div>
              </>
            )}

            <button type="button" class="primary-button" disabled={pin.status !== "ready"} onClick={confirmPin}>
              Confirmar ubicación
            </button>
            <button type="button" class="secondary-button" onClick={() => setView("search")}>
              Volver a buscar
            </button>
          </>
        )}

        {view === "details" && place && (
          <>
            <div class="address-card">
              <AddressLines address={place} />
              <button
                type="button"
                class="text-button"
                aria-label="Cambiar la dirección"
                onClick={() => setView("search")}
              >
                Cambiar
              </button>
            </div>

            <fieldset class="field">
              <legend>Etiqueta (opcional)</legend>
              <div class="choices">
                {ADDRESS_LABELS.map((option) => (
                  <button
                    type="button"
                    key={option}
                    class="choice label-chip"
                    aria-pressed={label === option ? "true" : "false"}
                    onClick={() => setLabel((current) => (current === option ? null : option))}
                  >
                    {ADDRESS_LABEL_TEXT[option]}
                  </button>
                ))}
              </div>
            </fieldset>

            <div class="field">
              <label for="address-between">¿Entre qué calles?</label>
              <input
                id="address-between"
                type="text"
                maxLength={BETWEEN_STREETS_MAX_LENGTH}
                value={betweenStreets}
                onInput={(event) => setBetweenStreets(event.currentTarget.value)}
              />
            </div>

            <div class="field">
              <label for="address-unit">Piso, depto o aclaración</label>
              <input
                id="address-unit"
                type="text"
                maxLength={DELIVERY_UNIT_MAX_LENGTH}
                value={unit}
                onInput={(event) => setUnit(event.currentTarget.value)}
              />
            </div>

            <button type="button" class="primary-button" onClick={confirm}>
              Confirmar dirección
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}

function AddressLines({ address }: { address: Pick<OrderDelivery, "formattedAddress" | "locality"> }) {
  const { main, secondary } = addressLines(address);
  return (
    <span class="address-card-text">
      <strong class="address-card-main">{main}</strong>
      {secondary && <span class="address-card-secondary">{secondary}</span>}
    </span>
  );
}
