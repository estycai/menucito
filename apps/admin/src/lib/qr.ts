import { encode } from "uqr";

/** Modules of white margin around the code; scanners need at least 4 for a clean read. */
const QUIET_ZONE = 4;
/** Side of a finder pattern (the three big corner squares), in modules. */
const FINDER_SIZE = 7;

export interface QrColors {
  /** Data modules. */
  ink: string;
  /** The three corner finders, where the brand color goes. */
  accent: string;
  background: string;
}

export const DEFAULT_QR_COLORS: QrColors = { ink: "#1c1917", accent: "#c2410c", background: "#ffffff" };

/** Whether module (x, y) of a code `size` modules wide belongs to one of the three finder patterns. */
export function isFinderModule(x: number, y: number, size: number): boolean {
  const inBand = (v: number) => v < FINDER_SIZE || v >= size - FINDER_SIZE;
  // Top-left, top-right and bottom-left corners; the bottom-right one has none.
  return inBand(x) && inBand(y) && !(x >= FINDER_SIZE && y >= FINDER_SIZE);
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * SVG of the QR for `text`: rounded data dots in `ink` and the three finders redrawn as rounded rings
 * in `accent`. Error correction is "Q" so the rounding and the colors cost nothing in scan reliability.
 */
export function qrSvg(text: string, colors: QrColors = DEFAULT_QR_COLORS): string {
  const { data, size } = encode(text, { ecc: "Q", border: 0 });
  const total = size + QUIET_ZONE * 2;
  const dots: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!data[y]![x] || isFinderModule(x, y, size)) continue;
      dots.push(`<rect x="${fmt(x + QUIET_ZONE + 0.04)}" y="${fmt(y + QUIET_ZONE + 0.04)}" width="0.92" height="0.92" rx="0.3"/>`);
    }
  }
  const finder = (x: number, y: number) => {
    const ox = x + QUIET_ZONE;
    const oy = y + QUIET_ZONE;
    return (
      `<rect x="${ox + 0.5}" y="${oy + 0.5}" width="6" height="6" rx="1.7" fill="none" stroke="${colors.accent}" stroke-width="1"/>` +
      `<rect x="${ox + 2}" y="${oy + 2}" width="3" height="3" rx="0.9" fill="${colors.accent}"/>`
    );
  };
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="geometricPrecision">` +
    `<rect width="${total}" height="${total}" fill="${colors.background}"/>` +
    `<g fill="${colors.ink}">${dots.join("")}</g>` +
    finder(0, 0) +
    finder(size - FINDER_SIZE, 0) +
    finder(0, size - FINDER_SIZE) +
    `</svg>`
  );
}

/** Renders `svg` to a PNG blob `pixels` wide, for the "Descargar" button. */
export async function svgToPngBlob(svg: string, pixels = 1024): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.width = pixels;
    image.height = pixels;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("QR image failed to load"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = pixels;
    canvas.height = pixels;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available");
    context.drawImage(image, 0, 0, pixels, pixels);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
