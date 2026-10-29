import { useRef, useState, type ChangeEvent } from "react";
import type { Restaurant } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { RestaurantAvatar } from "@/components/RestaurantAvatar";
import { Button } from "@/components/ui/button";
import { ImageEncodeError, LOGO_ACCEPT, normalizeLogo } from "@/lib/image";
import { ApiError, useRemoveLogo, useUploadLogo } from "@/lib/restaurant";

const MESSAGES = {
  unreadable: "No pudimos leer esa imagen. Probá con un PNG, JPG, WebP, GIF o SVG.",
  unsupportedBrowser: "Tu navegador no puede convertir la imagen. Probá con Chrome, Edge o Firefox.",
  tooLarge: "La imagen es demasiado pesada. Probá con otra.",
  uploadFailed: "No pudimos guardar el logo. Probá de nuevo.",
  removeFailed: "No pudimos quitar el logo. Probá de nuevo.",
} as const;

function uploadErrorMessage(error: unknown): string {
  if (error instanceof ImageEncodeError) return MESSAGES.unsupportedBrowser;
  if (error instanceof ApiError && error.status === 413) return MESSAGES.tooLarge;
  if (error instanceof ApiError && error.status === 415) return MESSAGES.unreadable;
  if (error instanceof ApiError || error instanceof TypeError) return MESSAGES.uploadFailed;
  return MESSAGES.unreadable;
}

/** "Apariencia" logo control: avatar with initials fallback, change and remove. Available on every plan. */
export function LogoUploader({ restaurant }: { restaurant: Restaurant }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = useUploadLogo();
  const remove = useRemoveLogo();

  const busy = processing || upload.isPending || remove.isPending;

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires `change`.
    event.target.value = "";
    if (!file) return;

    setError(null);
    setProcessing(true);
    try {
      const webp = await normalizeLogo(file);
      await upload.mutateAsync(webp);
    } catch (cause) {
      setError(uploadErrorMessage(cause));
    } finally {
      setProcessing(false);
    }
  }

  function onRemove() {
    setError(null);
    remove.mutate(undefined, { onError: () => setError(MESSAGES.removeFailed) });
  }

  const status = processing || upload.isPending ? "Subiendo..." : remove.isPending ? "Quitando..." : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <RestaurantAvatar name={restaurant.name} logoUrl={restaurant.logoUrl} className={busy ? "opacity-60" : undefined} />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 rounded-[10px] px-[18px] text-sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            Cambiar logo
          </Button>
          {restaurant.logoUrl && (
            <Button type="button" variant="ghost" className="min-h-11 text-sm text-muted" disabled={busy} onClick={onRemove}>
              Quitar logo
            </Button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={LOGO_ACCEPT}
          className="hidden"
          aria-label="Elegir logo"
          onChange={onFileChange}
        />
      </div>
      <p className="m-0 text-[13px] text-muted" aria-live="polite">
        {status ?? "PNG, JPG, WebP, GIF o SVG. Lo ajustamos a 512x512."}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
