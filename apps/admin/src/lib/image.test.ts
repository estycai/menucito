import { describe, expect, it } from "vitest";
import { LOGO_ACCEPT, containRect, isAcceptedLogoType } from "./image";
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
