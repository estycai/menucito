import { useMemo, useState } from "react";
import { hasCoordinates, type DeliveryZone, type LatLng, type LatLngTuple } from "@menucito/shared";
import { QueryError } from "@/components/QueryError";
import { ShippingCostCard, StoreSettingsGate } from "@/components/StoreSettingsCards";
import { ApiError } from "@/lib/restaurant";
import { checkZoneDrafts, draftFromZone, moveItem, newZoneDraft, type ZoneDraft, type ZoneErrors } from "@/lib/zone-form";
import { useDeliveryZones, useSaveDeliveryZones, useStoreLocation, type StoreLocation } from "@/lib/zones";
import { DeliveryModeCard, StoreAddressCard } from "./LocationCards";
import { ZoneListCard, type SaveStatus } from "./ZoneListCard";
import { ZonesMap } from "./ZonesMap";

const ZONES_MESSAGES = {
  loadFailed: "No pudimos cargar las zonas de entrega.",
  saved: "Zonas guardadas",
  invalid: "Revisá las zonas marcadas en rojo.",
  saveFailed: "No pudimos guardar las zonas. Probá de nuevo.",
} as const;

/** "Zonas de entrega": loads the location and the zones, then renders the editor. */
export function DeliveryZonesTab() {
  const location = useStoreLocation();
  const zones = useDeliveryZones();

  if (!location.data || !zones.data) {
    const failed = location.isError || zones.isError;
    return failed ? (
      <QueryError
        message={ZONES_MESSAGES.loadFailed}
        onRetry={() => {
          void location.refetch();
          void zones.refetch();
        }}
        retrying={location.isRefetching || zones.isRefetching}
      />
    ) : null;
  }

  return <DeliveryZonesEditor location={location.data} savedZones={zones.data.zones} />;
}

const toDrafts = (zones: readonly DeliveryZone[]) => zones.map(draftFromZone);
/** What is compared to tell whether the list has unsaved changes (keys are client-only). */
const comparable = (drafts: readonly ZoneDraft[]) => JSON.stringify(drafts.map((draft) => ({ ...draft, key: undefined })));

/**
 * Form on the left, map on the right (below it on narrow screens). The zone list is one draft saved
 * as a whole; the map and the forms edit the same drafts.
 */
function DeliveryZonesEditor({ location, savedZones }: { location: StoreLocation; savedZones: DeliveryZone[] }) {
  const save = useSaveDeliveryZones();
  const [drafts, setDrafts] = useState<ZoneDraft[]>(() => toDrafts(savedZones));
  const [baseline, setBaseline] = useState(() => comparable(toDrafts(savedZones)));
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<ReadonlySet<string>>(new Set());
  const [drawingKey, setDrawingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, ZoneErrors>>({});
  const [status, setStatus] = useState<SaveStatus>(null);

  const center: LatLng | null = hasCoordinates(location) ? { lat: location.lat, lng: location.lng } : null;
  const zonesMode = location.deliveryMode === "zones";
  const dirty = comparable(drafts) !== baseline;
  const visible = useMemo(() => drafts.filter((draft) => !hiddenKeys.has(draft.key)), [drafts, hiddenKeys]);

  function change(key: string, patch: Partial<ZoneDraft>) {
    setStatus(null);
    setDrafts((prev) => prev.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
    // An edited zone is checked again on save; until then its old errors would be misleading.
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function expand(key: string | null) {
    setExpandedKey(key);
    if (drawingKey !== key) setDrawingKey(null);
  }

  function toggleHidden(key: string) {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleDrawing(key: string) {
    if (drawingKey === key) {
      setDrawingKey(null);
      return;
    }
    // Drawing starts from scratch: every click adds the next point.
    change(key, { polygon: [] });
    setDrawingKey(key);
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function addPoint(key: string, point: LatLngTuple) {
    setDrafts((prev) => prev.map((draft) => (draft.key === key ? { ...draft, polygon: [...draft.polygon, point] } : draft)));
    setStatus(null);
  }

  function add() {
    const draft = newZoneDraft(drafts, `new-${crypto.randomUUID()}`);
    setDrafts((prev) => [...prev, draft]);
    expand(draft.key);
    setStatus(null);
  }

  function remove(key: string) {
    setDrafts((prev) => prev.filter((draft) => draft.key !== key));
    if (expandedKey === key) expand(null);
    setStatus(null);
  }

  function move(index: number, direction: -1 | 1) {
    setDrafts((prev) => moveItem(prev, index, direction));
    setStatus(null);
  }

  async function handleSave() {
    const check = checkZoneDrafts(drafts);
    if (check.errors) {
      setErrors(check.errors);
      setStatus({ tone: "error", text: ZONES_MESSAGES.invalid });
      // Open the first invalid zone so its errors are visible.
      const firstInvalid = drafts.find((draft) => check.errors[draft.key]);
      if (firstInvalid) expand(firstInvalid.key);
      return;
    }

    setStatus(null);
    try {
      const saved = await save.mutateAsync(check.inputs);
      const next = toDrafts(saved.zones);
      // New zones get their ids now: keep the open and hidden zones by position.
      const keyAt = (key: string | null) => (key === null ? null : (next[drafts.findIndex((draft) => draft.key === key)]?.key ?? null));
      setExpandedKey(keyAt(expandedKey));
      setHiddenKeys(new Set([...hiddenKeys].map(keyAt).filter((key): key is string => key !== null)));
      setDrawingKey(null);
      setDrafts(next);
      setBaseline(comparable(next));
      setErrors({});
      setStatus({ tone: "success", text: ZONES_MESSAGES.saved });
    } catch (error) {
      const text = error instanceof ApiError && error.code === "VALIDATION_ERROR" ? error.message : ZONES_MESSAGES.saveFailed;
      setStatus({ tone: "error", text });
    }
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-col gap-5 lg:basis-1/2">
        <StoreAddressCard location={location} />
        <DeliveryModeCard location={location} />
        {zonesMode ? (
          <ZoneListCard
            drafts={drafts}
            errors={errors}
            center={center}
            expandedKey={expandedKey}
            hiddenKeys={hiddenKeys}
            drawingKey={drawingKey}
            dirty={dirty}
            saving={save.isPending}
            status={status}
            onChange={change}
            onExpand={expand}
            onToggleHidden={toggleHidden}
            onToggleDrawing={toggleDrawing}
            onMove={move}
            onDelete={remove}
            onAdd={add}
            onSave={() => void handleSave()}
          />
        ) : (
          <StoreSettingsGate>{(settings) => <ShippingCostCard settings={settings} />}</StoreSettingsGate>
        )}
      </div>
      <aside aria-label="Mapa" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-white p-3 sm:p-4 lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)] lg:basis-1/2">
        <ZonesMap
          center={center}
          zones={zonesMode ? visible : []}
          selectedKey={expandedKey}
          drawingKey={drawingKey}
          onGeometryChange={change}
          onAddPoint={addPoint}
        />
        {zonesMode && drafts.length > 0 && (
          <p className="m-0 text-xs leading-[1.4] text-muted">Abrí una zona para ajustar su forma en el mapa. Guardá para aplicar los cambios.</p>
        )}
      </aside>
    </div>
  );
}
