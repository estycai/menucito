import { useState } from "react";
import { DEFAULT_COLORS } from "@menucito/shared";
import { AppearanceForm } from "@/components/AppearanceForm";
import { MenuPreview } from "@/components/MenuPreview";
import type { AppearanceDraft } from "@/lib/appearance";
import { useMyRestaurant } from "@/lib/restaurant";

/**
 * "Mi local": the "Apariencia" form on the left and the live phone preview on the right (below the
 * form on narrow screens). The other blocks of the canvas ("Datos del local", "Horarios") come later.
 */
export function LocalPage() {
  // `RequireRestaurant` guarantees the restaurant is loaded.
  const { data: restaurant } = useMyRestaurant();
  // The form reports its unsaved description and colors here; the preview draws them.
  const [draft, setDraft] = useState<AppearanceDraft>(() => ({
    description: restaurant?.description ?? "",
    colors: { ...DEFAULT_COLORS },
  }));
  if (!restaurant) return null;

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Mi local</h1>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-col gap-5 lg:flex-1">
          <AppearanceForm restaurant={restaurant} onDraftChange={setDraft} />
        </div>
        <aside
          aria-labelledby="preview-title"
          className="flex min-w-0 flex-col items-center gap-3.5 rounded-2xl border border-line bg-white p-4 sm:p-6 lg:sticky lg:top-6 lg:w-[380px] lg:shrink-0"
        >
          <div className="flex flex-col gap-0.5 self-stretch">
            <h2 id="preview-title" className="m-0 font-display text-xl font-extrabold">
              Vista previa
            </h2>
            <span className="text-[13px] text-muted">Así lo ve tu cliente. Se actualiza mientras editás.</span>
          </div>
          <MenuPreview restaurant={restaurant} draft={draft} />
          <p className="m-0 self-stretch text-center text-xs leading-[1.4] text-muted">
            Los colores y la portada se ven igual que en tu menú real. Guardá para publicar los cambios.
          </p>
        </aside>
      </div>
    </div>
  );
}
