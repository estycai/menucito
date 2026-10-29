import { LOGO_CONTENT_TYPE, LOGO_MAX_BYTES, LOGO_SIZE_PX, LOGO_SOURCE_TYPES } from "@menucito/shared";

/** The file is not an accepted image, or the browser could not decode it. */
export class ImageReadError extends Error {
  constructor(options?: ErrorOptions) {
    super("Could not read the image", options);
    this.name = "ImageReadError";
  }
}

/** The browser cannot produce a WebP small enough (e.g. no WebP encoder in `canvas.toBlob`). */
export class ImageEncodeError extends Error {
  constructor() {
    super("Could not encode the image as WebP");
    this.name = "ImageEncodeError";
  }
}

/** Value for the `accept` attribute of the logo file input. */
export const LOGO_ACCEPT = LOGO_SOURCE_TYPES.join(",");

export function isAcceptedLogoType(type: string): boolean {
  return LOGO_SOURCE_TYPES.includes(type.toLowerCase());
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where to draw a `width` x `height` image inside a `box` x `box` square so it fits entirely
 * ("contain"), keeping its aspect ratio and centered. Smaller images are scaled up.
 */
export function containRect(width: number, height: number, box: number): Rect {
  const scale = Math.min(box / width, box / height);
  // At least 1px, or an extreme aspect ratio (e.g. 5000x1) would round to nothing.
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { x: Math.round((box - w) / 2), y: Math.round((box - h) / 2), width: w, height: h };
}

/** Lower qualities are only tried when the first encode is over the upload limit. */
const WEBP_QUALITIES = [0.9, 0.75, 0.6];

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * Decodes through an `<img>`. Used for SVG: in image context scripts and external resources of
 * the SVG never run or load, and only the rasterized pixels leave this function.
 */
async function decodeWithImg(file: File, fallbackSize: number): Promise<Decoded> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  // SVGs without width/height have no intrinsic size: assume a square of the target size.
  const width = img.naturalWidth || fallbackSize;
  const height = img.naturalHeight || fallbackSize;
  return { source: img, width, height, release: () => URL.revokeObjectURL(url) };
}

async function decode(file: File): Promise<Decoded> {
  if (file.type === "image/svg+xml") return decodeWithImg(file, LOGO_SIZE_PX);
  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    return decodeWithImg(file, LOGO_SIZE_PX);
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, LOGO_CONTENT_TYPE, quality));
}

/**
 * Normalizes any accepted image (PNG, JPG, WebP, GIF, SVG) to a `LOGO_SIZE_PX` square WebP:
 * fitted with "contain", transparent padding. The original file is never uploaded.
 * Throws `ImageReadError` or `ImageEncodeError`.
 */
export async function normalizeLogo(file: File): Promise<Blob> {
  if (!isAcceptedLogoType(file.type)) throw new ImageReadError();

  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch (error) {
    throw new ImageReadError({ cause: error });
  }

  try {
    if (!decoded.width || !decoded.height) throw new ImageReadError();
    const canvas = document.createElement("canvas");
    canvas.width = LOGO_SIZE_PX;
    canvas.height = LOGO_SIZE_PX;
    const context = canvas.getContext("2d");
    if (!context) throw new ImageEncodeError();
    context.imageSmoothingQuality = "high";
    const rect = containRect(decoded.width, decoded.height, LOGO_SIZE_PX);
    context.drawImage(decoded.source, rect.x, rect.y, rect.width, rect.height);

    for (const quality of WEBP_QUALITIES) {
      let blob: Blob | null;
      try {
        blob = await toBlob(canvas, quality);
      } catch (error) {
        // A tainted canvas (should not happen with local files) cannot be exported.
        throw new ImageReadError({ cause: error });
      }
      // Browsers without a WebP encoder silently fall back to PNG.
      if (!blob || blob.type !== LOGO_CONTENT_TYPE) throw new ImageEncodeError();
      if (blob.size <= LOGO_MAX_BYTES) return blob;
    }
    throw new ImageEncodeError();
  } finally {
    decoded.release();
  }
}
