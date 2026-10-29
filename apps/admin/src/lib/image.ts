import {
  LOGO_MAX_BYTES,
  LOGO_SIZE_PX,
  LOGO_SOURCE_TYPES,
  MEDIA_CONTENT_TYPE,
  PRODUCT_PHOTO_MAX_BYTES,
  PRODUCT_PHOTO_SIZE_PX,
  PRODUCT_PHOTO_SOURCE_TYPES,
} from "@menucito/shared";

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

/**
 * Value for the `accept` attribute of the product photo input. `image/*` (and no `capture`) lets
 * phones offer both the camera and the gallery; the real type check is in `normalizeProductPhoto`.
 */
export const PRODUCT_PHOTO_ACCEPT = "image/*";

export function isAcceptedProductPhotoType(type: string): boolean {
  return PRODUCT_PHOTO_SOURCE_TYPES.includes(type.toLowerCase());
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

/**
 * Where to draw a `width` x `height` image so it fills a `box` x `box` square entirely ("cover"),
 * keeping its aspect ratio and centered: the overflowing side is cropped evenly on both ends.
 * Smaller images are scaled up.
 */
export function coverRect(width: number, height: number, box: number): Rect {
  const scale = Math.max(box / width, box / height);
  const w = Math.max(box, Math.round(width * scale));
  const h = Math.max(box, Math.round(height * scale));
  return { x: Math.round((box - w) / 2), y: Math.round((box - h) / 2), width: w, height: h };
}

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

async function decode(file: File, fallbackSize: number): Promise<Decoded> {
  if (file.type === "image/svg+xml") return decodeWithImg(file, fallbackSize);
  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    return decodeWithImg(file, fallbackSize);
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, MEDIA_CONTENT_TYPE, quality));
}

export interface NormalizeOptions {
  /** Side of the square output, in pixels. */
  size: number;
  /** "contain" fits the whole image with transparent padding; "cover" fills the square and crops. */
  fit: "contain" | "cover";
  /** Accepted source MIME types; anything else is an `ImageReadError`. */
  sourceTypes: readonly string[];
  /** Upload limit; lower qualities are only tried when an encode is over it. */
  maxBytes: number;
  /** WebP qualities to try, highest first. */
  qualities: readonly number[];
}

/**
 * Normalizes an accepted image to a square WebP of `size` pixels. The original file is never
 * uploaded. Throws `ImageReadError` or `ImageEncodeError`.
 */
export async function normalizeImage(file: File, options: NormalizeOptions): Promise<Blob> {
  if (!options.sourceTypes.includes(file.type.toLowerCase())) throw new ImageReadError();

  let decoded: Decoded;
  try {
    decoded = await decode(file, options.size);
  } catch (error) {
    throw new ImageReadError({ cause: error });
  }

  const canvas = document.createElement("canvas");
  try {
    if (!decoded.width || !decoded.height) throw new ImageReadError();
    canvas.width = options.size;
    canvas.height = options.size;
    const context = canvas.getContext("2d");
    if (!context) throw new ImageEncodeError();
    context.imageSmoothingQuality = "high";
    const place = options.fit === "cover" ? coverRect : containRect;
    const rect = place(decoded.width, decoded.height, options.size);
    context.drawImage(decoded.source, rect.x, rect.y, rect.width, rect.height);
  } finally {
    // Release the decoded source right after drawing: phone photos (12+ MP) are large.
    decoded.release();
  }

  for (const quality of options.qualities) {
    let blob: Blob | null;
    try {
      blob = await toBlob(canvas, quality);
    } catch (error) {
      // A tainted canvas (should not happen with local files) cannot be exported.
      throw new ImageReadError({ cause: error });
    }
    // Browsers without a WebP encoder silently fall back to PNG.
    if (!blob || blob.type !== MEDIA_CONTENT_TYPE) throw new ImageEncodeError();
    if (blob.size <= options.maxBytes) return blob;
  }
  throw new ImageEncodeError();
}

/**
 * Normalizes any accepted logo (PNG, JPG, WebP, GIF, SVG) to a `LOGO_SIZE_PX` square WebP:
 * fitted with "contain", transparent padding. Throws `ImageReadError` or `ImageEncodeError`.
 */
export function normalizeLogo(file: File): Promise<Blob> {
  return normalizeImage(file, {
    size: LOGO_SIZE_PX,
    fit: "contain",
    sourceTypes: LOGO_SOURCE_TYPES,
    maxBytes: LOGO_MAX_BYTES,
    qualities: [0.9, 0.75, 0.6],
  });
}

/**
 * Normalizes a product photo (PNG, JPG, WebP, GIF; no SVG) to a `PRODUCT_PHOTO_SIZE_PX` square
 * WebP, center-cropped with "cover". Throws `ImageReadError` or `ImageEncodeError`.
 */
export function normalizeProductPhoto(file: File): Promise<Blob> {
  return normalizeImage(file, {
    size: PRODUCT_PHOTO_SIZE_PX,
    fit: "cover",
    sourceTypes: PRODUCT_PHOTO_SOURCE_TYPES,
    maxBytes: PRODUCT_PHOTO_MAX_BYTES,
    qualities: [0.82, 0.7, 0.6],
  });
}
