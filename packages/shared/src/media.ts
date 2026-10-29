/** The only format the API stores and serves for uploaded media (logos and product photos). */
export const MEDIA_CONTENT_TYPE = "image/webp";

/** Logos are normalized in the browser to a square WebP of this size (in pixels). */
export const LOGO_SIZE_PX = 512;

/** Maximum size of an uploaded logo, in bytes (1 MB). */
export const LOGO_MAX_BYTES = 1024 * 1024;

/** The only format the API stores and serves for logos. */
export const LOGO_CONTENT_TYPE = MEDIA_CONTENT_TYPE;

/** Source formats the admin accepts before normalizing them to WebP. */
export const LOGO_SOURCE_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
];

/** Response of `PUT /api/restaurants/me/logo`. */
export interface LogoUploadResult {
  /** Public path of the new logo, e.g. `/api/media/logos/<restaurantId>/<random>.webp`. */
  logoUrl: string;
}

/** Product photos are normalized in the browser to a square WebP of this size ("cover"). */
export const PRODUCT_PHOTO_SIZE_PX = 800;

/** Maximum size of an uploaded product photo, in bytes (1 MB). */
export const PRODUCT_PHOTO_MAX_BYTES = 1024 * 1024;

/** Source formats accepted for product photos. No SVG: photos are not vector art. */
export const PRODUCT_PHOTO_SOURCE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Response of `PUT /api/products/:id/photo`. */
export interface ProductPhotoUploadResult {
  /** Public path of the new photo, e.g. `/api/media/products/<restaurantId>/<random>.webp`. */
  imageUrl: string;
}
