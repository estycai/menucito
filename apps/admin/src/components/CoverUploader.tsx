import { useRef, useState, type ChangeEvent } from "react";
import type { Restaurant } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { ImageEncodeError, PRODUCT_PHOTO_ACCEPT, normalizeCover } from "@/lib/image";
import { ApiError, useRemoveCover, useUploadCover } from "@/lib/restaurant";
import { cn } from "@/lib/utils";

const MESSAGES = {
  unreadable: "No pudimos leer esa imagen. Probá con una foto PNG, JPG, WebP o GIF.",
  unsupportedBrowser: "Tu navegador no puede convertir la imagen. Probá con Chrome, Edge o Firefox.",
  tooLarge: "La imagen es demasiado pesada. Probá con otra.",
  uploadFailed: "No pudimos guardar la portada. Probá de nuevo.",
  removeFailed: "No pudimos quitar la portada. Probá de nuevo.",
} as const;

function uploadErrorMessage(error: unknown): string {
  if (error instanceof ImageEncodeError) return MESSAGES.unsupportedBrowser;
  if (error instanceof ApiError && error.status === 413) return MESSAGES.tooLarge;
  if (error instanceof ApiError && error.status === 415) return MESSAGES.unreadable;
  if (error instanceof ApiError || error instanceof TypeError) return MESSAGES.uploadFailed;
  return MESSAGES.unreadable;
}

/** "Apariencia" cover control: 3:1 preview, change and remove. Uploads at once; available on every plan. */
export function CoverUploader({ restaurant }: { restaurant: Restaurant }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = useUploadCover();
  const remove = useRemoveCover();

  const busy = processing || upload.isPending || remove.isPending;

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires `change`.
    event.target.value = "";
    if (!file) return;

    setError(null);
    setProcessing(true);
    try {
      const webp = await normalizeCover(file);
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
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-bold">Foto de portada</span>
      {restaurant.coverUrl ? (
        <img
          src={restaurant.coverUrl}
          alt="Portada actual"
          width={1200}
          height={400}
          className={cn("aspect-[3/1] w-full rounded-[14px] border border-line bg-white object-cover", busy && "opacity-60")}
        />
      ) : (
        <div
          aria-hidden="true"
          className={cn("flex aspect-[3/1] w-full items-center justify-center rounded-[14px] border border-dashed border-[#a8a29e] bg-addon text-sm text-muted", busy && "opacity-60")}
        >
          Sin portada
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 rounded-[10px] px-[18px] text-sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {restaurant.coverUrl ? "Cambiar portada" : "Elegir portada"}
        </Button>
        {restaurant.coverUrl && (
          <Button type="button" variant="ghost" className="min-h-11 text-sm text-muted" disabled={busy} onClick={onRemove}>
            Quitar portada
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={PRODUCT_PHOTO_ACCEPT}
        className="hidden"
        aria-label="Elegir portada"
        onChange={onFileChange}
      />
      <p className="m-0 text-xs leading-[1.4] text-muted" aria-live="polite">
        {status ?? "Recomendado: 1200 × 400 px, JPG o PNG. Se recorta al centro y se comprime sola."}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
