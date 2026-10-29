import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Notice } from "@/components/AuthLayout";
import { ProBadge } from "@/components/ProBadge";
import { Button } from "@/components/ui/button";
import { useRemoveProductPhoto, useUploadProductPhoto } from "@/lib/catalog";
import { ImageEncodeError, PRODUCT_PHOTO_ACCEPT, normalizeProductPhoto } from "@/lib/image";
import { ApiError } from "@/lib/restaurant";
import { cn } from "@/lib/utils";

const MESSAGES = {
  unreadable: "No pudimos leer esa imagen. Probá con una foto PNG, JPG, WebP o GIF.",
  unsupportedBrowser: "Tu navegador no puede convertir la imagen. Probá con Chrome, Edge o Firefox.",
  tooLarge: "La imagen es demasiado pesada. Probá con otra.",
  planLimit: "Tu plan no incluye fotos de productos.",
  uploadFailed: "No pudimos guardar la foto. Probá de nuevo.",
  removeFailed: "No pudimos quitar la foto. Probá de nuevo.",
} as const;

function uploadErrorMessage(error: unknown): string {
  if (error instanceof ImageEncodeError) return MESSAGES.unsupportedBrowser;
  if (error instanceof ApiError && error.status === 413) return MESSAGES.tooLarge;
  if (error instanceof ApiError && error.status === 415) return MESSAGES.unreadable;
  if (error instanceof ApiError && error.code === "PLAN_LIMIT") return MESSAGES.planLimit;
  if (error instanceof ApiError || error instanceof TypeError) return MESSAGES.uploadFailed;
  return MESSAGES.unreadable;
}

/**
 * Data URL to preview a (small, already normalized) blob. A data URL instead of an object URL:
 * nothing to revoke, so it survives StrictMode's double effects.
 */
function usePreviewUrl(blob: Blob | null) {
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPreview({ blob, url: reader.result });
    };
    reader.readAsDataURL(blob);
    return () => reader.abort();
  }, [blob]);
  return blob && preview?.blob === blob ? preview.url : null;
}

interface ProductPhotoUploaderProps {
  /** Existing product: photos are uploaded and removed at once. Omit for a product being created. */
  productId?: string;
  /** Current photo of the existing product. */
  imageUrl: string | null;
  /** Whether the plan allows uploading photos (removing is always allowed). */
  allowed: boolean;
  /** New product only: the normalized photo to upload right after the product is created. */
  pending?: Blob | null;
  onPendingChange?: (webp: Blob | null) => void;
}

/** "Datos básicos" photo control: 96 px square preview, "Cambiar foto" and "Quitar foto". */
export function ProductPhotoUploader({ productId, imageUrl, allowed, pending = null, onPendingChange }: ProductPhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  /** Normalized photo being uploaded, shown until the server URL arrives. */
  const [uploading, setUploading] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = useUploadProductPhoto();
  const remove = useRemoveProductPhoto();
  const localPreview = usePreviewUrl(uploading ?? pending);

  const busy = processing || upload.isPending || remove.isPending;
  const preview = localPreview ?? imageUrl;
  const hasPhoto = Boolean(pending || imageUrl);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires `change`.
    event.target.value = "";
    if (!file) return;

    setError(null);
    setProcessing(true);
    try {
      const webp = await normalizeProductPhoto(file);
      if (!productId) {
        onPendingChange?.(webp);
        return;
      }
      setUploading(webp);
      await upload.mutateAsync({ id: productId, webp });
    } catch (cause) {
      setError(uploadErrorMessage(cause));
    } finally {
      setUploading(null);
      setProcessing(false);
    }
  }

  function onRemove() {
    setError(null);
    if (!productId) {
      onPendingChange?.(null);
      return;
    }
    remove.mutate(productId, { onError: () => setError(MESSAGES.removeFailed) });
  }

  const status = processing || upload.isPending ? "Procesando foto..." : remove.isPending ? "Quitando..." : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        {preview ? (
          <img
            src={preview}
            alt="Foto del producto"
            className={cn("size-24 shrink-0 rounded-[14px] border border-line bg-white object-cover", busy && "opacity-60")}
          />
        ) : (
          <div aria-hidden="true" className="flex size-24 shrink-0 items-center justify-center rounded-[14px] bg-[#EBD9C6]">
            <PhotoIcon />
          </div>
        )}
        <div className="flex min-w-0 flex-col items-start gap-2">
          {allowed ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 rounded-[10px] px-[18px] text-sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              Cambiar foto
            </Button>
          ) : (
            <span className="flex min-h-11 items-center gap-2 text-sm text-muted">
              Fotos de productos <ProBadge />
            </span>
          )}
          {hasPhoto && (
            <Button type="button" variant="ghost" className="min-h-11 px-3 text-sm text-muted" disabled={busy} onClick={onRemove}>
              Quitar foto
            </Button>
          )}
          <span className="text-xs text-muted" aria-live="polite">
            {status ?? "Se comprime sola antes de subir."}
          </span>
        </div>
        {/* `image/*` without `capture`: phones offer both the camera and the gallery. */}
        <input
          ref={inputRef}
          type="file"
          accept={PRODUCT_PHOTO_ACCEPT}
          className="hidden"
          aria-label="Elegir foto del producto"
          onChange={onFileChange}
        />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function PhotoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-8 text-[#9A7B5F]" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m4 17 5-5 4 4 2.5-2.5L20 17" strokeLinejoin="round" />
    </svg>
  );
}
