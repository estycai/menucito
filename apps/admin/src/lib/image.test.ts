import { describe, expect, it } from "vitest";
import {
  LOGO_ACCEPT,
  PRODUCT_PHOTO_ACCEPT,
  containRect,
  coverRect,
  isAcceptedLogoType,
  isAcceptedProductPhotoType,
} from "./image";
import { initials } from "./initials";

describe("containRect", () => {
  it("fits a wide image to the box width and centers it vertically", () => {
    expect(containRect(1000, 500, 512)).toEqual({ x: 0, y: 128, width: 512, height: 256 });
  });

  it("fits a tall image to the box height and centers it horizontally", () => {
    expect(containRect(300, 600, 512)).toEqual({ x: 128, y: 0, width: 256, height: 512 });
  });

  it("scales a small square image up to the whole box", () => {
    expect(containRect(64, 64, 512)).toEqual({ x: 0, y: 0, width: 512, height: 512 });
  });

  it("never collapses an extreme aspect ratio to zero pixels", () => {
    expect(containRect(5000, 1, 512)).toEqual({ x: 0, y: 256, width: 512, height: 1 });
  });

  it("keeps the aspect ratio for odd sizes", () => {
    const rect = containRect(333, 777, 512);
    expect(rect.height).toBe(512);
    expect(rect.width).toBe(Math.round(333 * (512 / 777)));
    expect(rect.x * 2 + rect.width).toBeGreaterThanOrEqual(511);
  });
});

describe("coverRect", () => {
  it("fills the box with a wide image, cropping left and right evenly", () => {
    expect(coverRect(1000, 500, 800)).toEqual({ x: -400, y: 0, width: 1600, height: 800 });
  });

  it("fills the box with a tall image, cropping top and bottom evenly", () => {
    expect(coverRect(300, 600, 800)).toEqual({ x: 0, y: -400, width: 800, height: 1600 });
  });

  it("scales a tiny image up to the whole box", () => {
    expect(coverRect(16, 16, 800)).toEqual({ x: 0, y: 0, width: 800, height: 800 });
  });

  it("scales a large phone photo down, keeping its aspect ratio", () => {
    expect(coverRect(4032, 3024, 800)).toEqual({ x: -133, y: 0, width: 1067, height: 800 });
  });

  it("always covers the box, even with rounding", () => {
    for (const [w, h] of [
      [333, 777],
      [5000, 1],
      [1, 5000],
      [801, 799],
    ] as const) {
      const rect = coverRect(w, h, 800);
      expect(rect.x).toBeLessThanOrEqual(0);
      expect(rect.y).toBeLessThanOrEqual(0);
      expect(rect.x + rect.width).toBeGreaterThanOrEqual(800);
      expect(rect.y + rect.height).toBeGreaterThanOrEqual(800);
    }
  });
});

describe("isAcceptedProductPhotoType", () => {
  it.each(["image/png", "image/jpeg", "image/webp", "image/gif", "IMAGE/JPEG"])("accepts %s", (type) => {
    expect(isAcceptedProductPhotoType(type)).toBe(true);
  });

  it.each(["image/svg+xml", "image/heic", "application/pdf", ""])("rejects %s", (type) => {
    expect(isAcceptedProductPhotoType(type)).toBe(false);
  });

  it("lets phones offer camera and gallery", () => {
    expect(PRODUCT_PHOTO_ACCEPT).toBe("image/*");
  });
});

describe("isAcceptedLogoType", () => {
  it.each(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "IMAGE/PNG"])("accepts %s", (type) => {
    expect(isAcceptedLogoType(type)).toBe(true);
  });

  it.each(["application/pdf", "image/bmp", "image/tiff", "text/html", ""])("rejects %s", (type) => {
    expect(isAcceptedLogoType(type)).toBe(false);
  });

  it("builds the file input accept list from the same types", () => {
    expect(LOGO_ACCEPT).toBe("image/png,image/jpeg,image/webp,image/gif,image/svg+xml");
  });
});

describe("initials", () => {
  it.each([
    ["Lo de Marta", "LM"],
    ["pizzería", "P"],
    ["  El   Buen  Sabor ", "ES"],
    ["", ""],
  ])("%s -> %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
