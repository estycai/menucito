import { useEffect, useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { DEFAULT_COLORS, RESTAURANT_DESCRIPTION_MAX_LENGTH, type Restaurant } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { BACKGROUND_SWATCHES, ColorField, ColorReadOnly, PRIMARY_SWATCHES } from "@/components/ColorField";
import { CoverUploader } from "@/components/CoverUploader";
import { LogoUploader } from "@/components/LogoUploader";
import { ProLock } from "@/components/ProLock";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import {
  canCustomizeColors,
  checkAppearance,
  draftColors,
  valuesFromRestaurant,
  type AppearanceDraft,
  type AppearanceValues,
} from "@/lib/appearance";
import { useUpdateAppearance } from "@/lib/restaurant";

const MESSAGES = {
  saved: "Cambios guardados",
  saveFailed: "No pudimos guardar los cambios. Probá de nuevo.",
  basicNote: "En el Plan Básico se usan los colores por defecto de Menucito.",
} as const;

/** Collapses whitespace like the API does, so the preview shows what will be saved. */
const normalizeSpaces = (text: string) => text.replace(/\s+/g, " ").trim();

interface AppearanceFormProps {
  restaurant: Restaurant;
  /** Called with the unsaved description and colors on every change, for the live preview. */
  onDraftChange: (draft: AppearanceDraft) => void;
}

/**
 * "Apariencia" card: cover and logo (uploaded at once), and the description and colors that are
 * saved together with "Guardar cambios". Colors are a Pro feature.
 */
export function AppearanceForm({ restaurant, onDraftChange }: AppearanceFormProps) {
  const id = useId();
  const customColors = canCustomizeColors(restaurant);
  const update = useUpdateAppearance();
  const [status, setStatus] = useState<"saved" | "error" | null>(null);

  const { register, control, setValue, reset, handleSubmit } = useForm<AppearanceValues>({
    defaultValues: valuesFromRestaurant(restaurant),
  });
  const values = useWatch({ control }) as AppearanceValues;
  const check = checkAppearance(restaurant, values, customColors);
  const colors = draftColors(restaurant, values, customColors);
  const description = values.description ?? "";

  // Report the draft to the preview. Compared by value so unrelated re-renders do nothing.
  const previewDescription = normalizeSpaces(description);
  useEffect(() => {
    onDraftChange({ description: previewDescription, colors: { background: colors.background, primary: colors.primary } });
  }, [onDraftChange, previewDescription, colors.background, colors.primary]);

  const setColor = (key: "bgColor" | "primaryColor") => (value: string) => {
    setStatus(null);
    setValue(key, value, { shouldDirty: true });
  };

  const canReset = customColors && (values.bgColor !== DEFAULT_COLORS.background || values.primaryColor !== DEFAULT_COLORS.primary);

  async function onSubmit() {
    if (!check.changes || check.invalid) return;
    setStatus(null);
    try {
      const updated = await update.mutateAsync(check.changes);
      reset(valuesFromRestaurant(updated));
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  const descriptionId = `${id}-description`;
  const descriptionError = check.errors.description;

  return (
    <SectionCard title="Apariencia">
      <CoverUploader restaurant={restaurant} />
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-bold">Logo</span>
        <LogoUploader restaurant={restaurant} />
      </div>

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={descriptionId} className="text-[13px] font-bold">
            Descripción breve
          </label>
          <textarea
            id={descriptionId}
            rows={3}
            maxLength={RESTAURANT_DESCRIPTION_MAX_LENGTH}
            aria-invalid={descriptionError ? true : undefined}
            aria-describedby={[`${descriptionId}-count`, descriptionError && `${descriptionId}-error`].filter(Boolean).join(" ")}
            className="box-border w-full resize-none rounded-xl border border-line bg-white px-3.5 py-3 text-base leading-[1.4] text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-danger"
            {...register("description", { onChange: () => setStatus(null) })}
          />
          <span id={`${descriptionId}-count`} className="self-end text-xs text-muted">
            {description.length}/{RESTAURANT_DESCRIPTION_MAX_LENGTH}
          </span>
          {descriptionError && (
            <p id={`${descriptionId}-error`} className="m-0 text-[13px] text-danger">
              {descriptionError}
            </p>
          )}
        </div>

        {customColors ? (
          <section aria-labelledby={`${id}-colors`} className="flex flex-col gap-3 border-t border-line-soft pt-4">
            <h3 id={`${id}-colors`} className="m-0 text-[13px] font-bold">
              Colores de tu menú
            </h3>
            <ColorField
              label="Color de fondo"
              value={values.bgColor ?? ""}
              onChange={setColor("bgColor")}
              swatches={BACKGROUND_SWATCHES}
              error={check.errors.bgColor}
            />
            <ColorField
              label="Color principal"
              value={values.primaryColor ?? ""}
              onChange={setColor("primaryColor")}
              swatches={PRIMARY_SWATCHES}
              error={check.errors.primaryColor}
              warning={check.warnings.primaryColor}
            />
            <div>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 px-3 text-sm text-muted"
                disabled={!canReset}
                onClick={() => {
                  setStatus(null);
                  setValue("bgColor", DEFAULT_COLORS.background, { shouldDirty: true });
                  setValue("primaryColor", DEFAULT_COLORS.primary, { shouldDirty: true });
                }}
              >
                Usar los colores de Menucito
              </Button>
            </div>
          </section>
        ) : (
          <LockedColors restaurant={restaurant} />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">{status === "saved" && <Notice tone="success">{MESSAGES.saved}</Notice>}</div>
          <Button type="submit" className="min-h-12 rounded-xl px-[26px] text-[15px]" disabled={!check.changes || check.invalid || update.isPending}>
            Guardar cambios
          </Button>
        </div>
        {status === "error" && <Notice tone="error">{MESSAGES.saveFailed}</Notice>}
      </form>
    </SectionCard>
  );
}

/** Basic plan: the lock with a static example, or the colors saved before a downgrade, read-only. */
function LockedColors({ restaurant }: { restaurant: Restaurant }) {
  const hasSaved = Boolean(restaurant.bgColor ?? restaurant.primaryColor);
  return (
    <ProLock title="Colores de tu menú" description="Elegí el color de fondo y el color principal de tu menú público.">
      <p className="m-0 text-xs leading-[1.4] text-muted">{MESSAGES.basicNote}</p>
      {hasSaved ? (
        <div className="flex flex-col gap-2">
          <ColorReadOnly label="Color de fondo" hex={restaurant.bgColor ?? DEFAULT_COLORS.background} />
          <ColorReadOnly label="Color principal" hex={restaurant.primaryColor ?? DEFAULT_COLORS.primary} />
        </div>
      ) : (
        <div inert aria-hidden="true" className="flex items-center gap-2.5">
          {[...BACKGROUND_SWATCHES.slice(0, 2), ...PRIMARY_SWATCHES.slice(0, 2)].map((swatch) => (
            <span key={swatch.hex} style={{ backgroundColor: swatch.hex }} className="size-9 rounded-full border border-line-strong" />
          ))}
        </div>
      )}
    </ProLock>
  );
}
