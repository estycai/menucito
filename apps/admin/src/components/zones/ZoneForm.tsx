import { useId, useState } from "react";
import { ZONE_POLYGON_MIN_POINTS, type LatLng, type ZonePricing, type ZoneShape } from "@menucito/shared";
import { ColorField, type Swatch } from "@/components/ColorField";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ZONE_COLORS, ZONE_RADIUS_STEP_M, squareAround, type ZoneDraft, type ZoneErrors } from "@/lib/zone-form";
import { SegmentedControl } from "./SegmentedControl";

const SHAPE_OPTIONS = [
  { value: "radius", label: "Radio" },
  { value: "ring", label: "Anillo" },
  { value: "polygon", label: "Forma" },
] as const satisfies readonly { value: ZoneShape; label: string }[];

const PRICING_OPTIONS = [
  { value: "fixed", label: "Fijo (por envío)" },
  { value: "per_km", label: "Variable (por km)" },
] as const satisfies readonly { value: ZonePricing; label: string }[];

const COLOR_NAMES = ["Naranja", "Verde", "Azul", "Violeta", "Ámbar", "Rosa"];
const ZONE_SWATCHES: readonly Swatch[] = ZONE_COLORS.map((hex, i) => ({ hex, name: COLOR_NAMES[i] ?? hex }));

const SHAPE_HINTS: Record<ZoneShape, string> = {
  radius: "Un círculo alrededor del local. Arrastrá el borde en el mapa o escribí el radio.",
  ring: "Una franja entre dos distancias del local. Ideal para cobrar más a los que están más lejos.",
  polygon: "Un área a medida. Arrastrá los puntos en el mapa; clic derecho sobre un punto lo borra.",
};

/** The form of one zone, shown when its row is expanded. Geometry edits also come from the map. */
export function ZoneForm({
  draft,
  errors,
  center,
  drawing,
  onChange,
  onToggleDrawing,
}: {
  draft: ZoneDraft;
  errors: ZoneErrors | undefined;
  /** The store, where a new drawing starts. */
  center: LatLng | null;
  /** Whether map clicks add points to this zone. */
  drawing: boolean;
  onChange: (patch: Partial<ZoneDraft>) => void;
  onToggleDrawing: () => void;
}) {
  function changeShape(shape: ZoneShape) {
    const patch: Partial<ZoneDraft> = { shape };
    // A ring needs room inside; a new polygon starts as a square the owner reshapes.
    if (shape === "ring" && draft.innerRadiusM <= 0) {
      patch.innerRadiusM = draft.radiusM;
      patch.radiusM = draft.radiusM + ZONE_RADIUS_STEP_M;
    }
    if (shape === "polygon" && draft.polygon.length === 0 && center) patch.polygon = squareAround(center, draft.radiusM * 2);
    onChange(patch);
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-bg/50 p-3.5 sm:p-4">
      <FormField label="Nombre" value={draft.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} error={errors?.name} />

      <ColorField label="Color" value={draft.color} onChange={(color) => onChange({ color })} swatches={ZONE_SWATCHES} error={errors?.color} />

      <div className="flex flex-col gap-2">
        <SegmentedControl label="Forma" value={draft.shape} options={SHAPE_OPTIONS} onChange={changeShape} />
        <p className="m-0 text-xs text-muted">{SHAPE_HINTS[draft.shape]}</p>
      </div>

      {draft.shape === "radius" && (
        <KmField label="Radio" meters={draft.radiusM} onChange={(radiusM) => onChange({ radiusM })} error={errors?.radiusM} />
      )}
      {draft.shape === "ring" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <KmField label="Desde" meters={draft.innerRadiusM} onChange={(innerRadiusM) => onChange({ innerRadiusM })} error={errors?.innerRadiusM} />
          <KmField label="Hasta" meters={draft.radiusM} onChange={(radiusM) => onChange({ radiusM })} error={errors?.radiusM} />
        </div>
      )}
      {draft.shape === "polygon" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="px-4" onClick={onToggleDrawing} aria-pressed={drawing}>
              {drawing ? "Listo" : "Dibujar en el mapa"}
            </Button>
            <span className="text-xs text-muted">
              {drawing
                ? `Hacé clic en el mapa para marcar los puntos (mínimo ${ZONE_POLYGON_MIN_POINTS}).`
                : `${draft.polygon.length} puntos`}
            </span>
          </div>
          {errors?.polygon && <p className="m-0 text-[13px] text-danger">{errors.polygon}</p>}
        </div>
      )}

      <SegmentedControl label="Precio" value={draft.pricing} options={PRICING_OPTIONS} onChange={(pricing) => onChange({ pricing })} />

      {draft.pricing === "fixed" ? (
        <div className="sm:max-w-[240px]">
          <MoneyField label="Costo de envío" value={draft.price} onChange={(price) => onChange({ price })} hint="Poné 0 si el envío es gratis." error={errors?.price} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyField label="Precio base" value={draft.base} onChange={(base) => onChange({ base })} error={errors?.base} />
          <MoneyField label="Por km" value={draft.perKm} onChange={(perKm) => onChange({ perKm })} error={errors?.perKm} />
          <MoneyField label="Envío mínimo" value={draft.minShipping} onChange={(minShipping) => onChange({ minShipping })} hint="Opcional." error={errors?.minShipping} />
          <MoneyField label="Envío máximo" value={draft.maxShipping} onChange={(maxShipping) => onChange({ maxShipping })} hint="Opcional." error={errors?.maxShipping} />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyField label="Pedido mínimo" value={draft.minOrder} onChange={(minOrder) => onChange({ minOrder })} hint="Dejalo vacío si no hay mínimo." error={errors?.minOrder} />
        <MoneyField label="Envío gratis desde" value={draft.freeFrom} onChange={(freeFrom) => onChange({ freeFrom })} hint="Dejalo vacío si nunca es gratis." error={errors?.freeFrom} />
      </div>
    </div>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
}) {
  return <FormField label={label} prefix="$" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} hint={hint} error={error} />;
}

const formatKm = (meters: number) => (meters / 1000).toLocaleString("es-AR", { maximumFractionDigits: 2 });

/** Parses "2,5" or "2.5" km to whole meters; `null` when it is not a positive number. */
function parseKm(text: string): number | null {
  const km = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(km) && km > 0 ? Math.round(km * 1000) : null;
}

/**
 * A distance typed in km and stored in meters. The text is kept while typing ("2,") and replaced
 * only when the meters change from outside (the map).
 */
function KmField({ label, meters, onChange, error }: { label: string; meters: number; onChange: (meters: number) => void; error?: string }) {
  const id = useId();
  const [text, setText] = useState(() => formatKm(meters));
  const [shown, setShown] = useState(meters);
  if (meters !== shown) {
    setShown(meters);
    setText(formatKm(meters));
  }
  const typedInvalid = parseKm(text) === null;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold">
        {label}
      </label>
      <div className="relative sm:max-w-[200px]">
        <Input
          id={id}
          inputMode="decimal"
          value={text}
          aria-invalid={error || typedInvalid ? true : undefined}
          aria-describedby={error || typedInvalid ? `${id}-error` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            const next = parseKm(e.target.value);
            if (next !== null) {
              setShown(next);
              onChange(next);
            }
          }}
          className="pr-12"
        />
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-muted">
          km
        </span>
      </div>
      {(error || typedInvalid) && (
        <p id={`${id}-error`} className="m-0 text-[13px] text-danger">
          {typedInvalid ? "Ingresá una distancia en km" : error}
        </p>
      )}
    </div>
  );
}
