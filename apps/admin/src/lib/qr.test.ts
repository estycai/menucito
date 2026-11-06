import { describe, expect, it } from "vitest";
import { isFinderModule, qrSvg } from "./qr";

describe("isFinderModule", () => {
  it("covers the three corner finders of a 25-module code", () => {
    expect(isFinderModule(0, 0, 25)).toBe(true);
    expect(isFinderModule(6, 6, 25)).toBe(true);
    expect(isFinderModule(18, 0, 25)).toBe(true);
    expect(isFinderModule(24, 6, 25)).toBe(true);
    expect(isFinderModule(0, 18, 25)).toBe(true);
    expect(isFinderModule(6, 24, 25)).toBe(true);
  });

  it("leaves the bottom-right corner and the middle as data", () => {
    expect(isFinderModule(24, 24, 25)).toBe(false);
    expect(isFinderModule(12, 12, 25)).toBe(false);
    expect(isFinderModule(7, 0, 25)).toBe(false);
    expect(isFinderModule(0, 7, 25)).toBe(false);
  });
});

describe("qrSvg", () => {
  it("returns a self-contained svg with the accent color on the finders", () => {
    const svg = qrSvg("https://menucito.com/mi-local");
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg).toContain('viewBox="0 0 ');
    expect(svg.match(/stroke="#c2410c"/g)).toHaveLength(3);
  });

  it("is deterministic and differs per link", () => {
    expect(qrSvg("https://menucito.com/a")).toBe(qrSvg("https://menucito.com/a"));
    expect(qrSvg("https://menucito.com/a")).not.toBe(qrSvg("https://menucito.com/b"));
  });
});
