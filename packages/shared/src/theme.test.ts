import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "./plans";
import { hexColorSchema } from "./restaurant";
import {
  DEFAULT_COLORS,
  colorsProblem,
  contrastRatio,
  normalizeHexColor,
  themeCssVars,
  themeFromColors,
} from "./theme";

const AA = 4.5;

describe("default colors (scenario 1)", () => {
  const theme = themeFromColors(DEFAULT_COLORS);

  it("keeps the current brand and corrects nothing", () => {
    expect(DEFAULT_COLORS).toEqual({ background: "#F7F5F2", primary: "#C2410C" });
    expect(theme.ink).toBe("#1C1917");
    expect(theme.surface).toBe("#FFFFFF");
    expect(theme.onPrimary).toBe("#FFFFFF");
    expect(theme.primary).toBe("#C2410C");
    expect(theme.accent).toBe("#C2410C");
  });

  it("derives a hover shade only when the on-primary text still reads on it", () => {
    // #C2410C is only 5.2:1 with white, so a lighter hover would drop below 4.5:1: it stays equal.
    expect(theme.primaryHover).toBe(theme.primary);
    const navy = themeFromColors({ background: "#F7F5F2", primary: "#1E3A8A" });
    expect(navy.primaryHover).not.toBe(navy.primary);
    expect(contrastRatio(navy.onPrimary, navy.primaryHover)).toBeGreaterThanOrEqual(AA);
  });

  it("emits the tokens global.css uses", () => {
    const vars = themeCssVars(theme);
    for (const token of [
      "--color-bg",
      "--color-ink",
      "--color-surface",
      "--color-muted",
      "--color-primary",
      "--color-on-primary",
      "--color-primary-hover",
      "--color-link",
      "--color-danger",
      "--color-line",
      "--color-tab",
      "--color-primary-soft",
      "--color-nav-active",
      "--color-addon",
      "--color-cover",
    ]) {
      expect(vars).toContain(`${token}: #`);
    }
    expect(vars).toContain("--color-bg: #F7F5F2;");
  });
});

describe("contrast guarantees (scenario 2)", () => {
  const NAMED = [
    "#FFFFFF", "#000000", "#808080", "#999999", "#333333", "#CCCCCC", "#F7F5F2", "#1C1917",
    "#FEF3C7", "#FACC15", "#16A34A", "#86EFAC", "#1D4ED8", "#93C5FD", "#DC2626", "#FCA5A5",
    "#7C3AED", "#C4B5FD", "#C2410C", "#0F172A", "#A16207", "#6B7280", "#B45309", "#EAB308",
  ];
  // A gray ramp covers the dark, mid and light bands, where the fallbacks are exercised.
  const GRAYS = Array.from({ length: 17 }, (_, i) => {
    const hex = Math.min(255, i * 16).toString(16).padStart(2, "0").toUpperCase();
    return `#${hex}${hex}${hex}`;
  });
  const COLORS = [...NAMED, ...GRAYS];
  const pairs = COLORS.flatMap((background) => COLORS.map((primary) => ({ background, primary })));

  it("meets 4.5:1 for every text color on every background, for every pair", () => {
    for (const colors of pairs) {
      const t = themeFromColors(colors);
      const label = `${colors.background} / ${colors.primary}`;
      const readable = (a: string, b: string, what: string) =>
        expect(contrastRatio(a, b), `${what} (${label})`).toBeGreaterThanOrEqual(AA);

      readable(t.ink, t.background, "ink/bg");
      readable(t.ink, t.surface, "ink/surface");
      readable(t.muted, t.background, "muted/bg");
      readable(t.muted, t.surface, "muted/surface");
      readable(t.onPrimary, t.primary, "onPrimary/primary");
      readable(t.accent, t.background, "accent/bg");
      readable(t.accent, t.surface, "accent/surface");
      readable(t.danger, t.background, "danger/bg");
      readable(t.danger, t.surface, "danger/surface");
      readable(t.ink, t.primarySoft, "ink/primarySoft");
      expect(t.primary).toBe(colors.primary);
      expect(t.background).toBe(colors.background);
    }
  });

  it("returns only #RRGGBB values", () => {
    for (const colors of pairs.slice(0, 200)) {
      for (const value of Object.values(themeFromColors(colors))) expect(value).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe("light and dark backgrounds (scenario 3)", () => {
  it("uses a light ink and cards darker than the page on a dark background", () => {
    const theme = themeFromColors({ background: "#1C1917", primary: "#C2410C" });
    expect(theme.ink).toBe("#FFFFFF");
    expect(theme.surface).not.toBe("#FFFFFF");
    expect(contrastRatio(theme.surface, "#000000")).toBeLessThan(contrastRatio("#1C1917", "#000000"));
  });

  it("uses white cards on a light background", () => {
    expect(themeFromColors({ background: "#FEF3C7", primary: "#C2410C" }).surface).toBe("#FFFFFF");
  });
});

describe("primary that does not carry white (scenario 4)", () => {
  const theme = themeFromColors({ background: "#F7F5F2", primary: "#16A34A" });

  it("switches the on-primary text and keeps the fill exact", () => {
    expect(contrastRatio("#FFFFFF", "#16A34A")).toBeLessThan(AA);
    expect(theme.onPrimary).toBe("#1C1917");
    expect(theme.primary).toBe("#16A34A");
  });

  it("darkens the accent until it reads as text", () => {
    expect(theme.accent).not.toBe("#16A34A");
    expect(contrastRatio(theme.accent, "#F7F5F2")).toBeGreaterThanOrEqual(AA);
  });
});

describe("colorsProblem (scenario 5)", () => {
  it("accepts the defaults", () => {
    expect(colorsProblem(DEFAULT_COLORS)).toBeNull();
  });

  it.each([
    { background: "#1C1917", primary: "#1D4ED8" },
    { background: "#FFFFFF", primary: "#FEF3C7" },
  ])("flags a primary that blends into the background: %o", (colors) => {
    expect(colorsProblem(colors)).toBe("contrast");
  });

  it("accepts a medium green on a light background (3:1 is enough)", () => {
    expect(colorsProblem({ background: "#F7F5F2", primary: "#16A34A" })).toBeNull();
  });
});

describe("hex colors (scenario 5)", () => {
  it.each([
    ["#abc", "#AABBCC"],
    ["abc", "#AABBCC"],
    ["#AABBCC", "#AABBCC"],
    ["aabbcc", "#AABBCC"],
    ["  #c2410c ", "#C2410C"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeHexColor(input)).toBe(expected);
    expect(hexColorSchema.parse(input)).toBe(expected);
  });

  it.each(["#12", "#GGGGGG", "rgb(0,0,0)", "", "#12345", "#1234567", "#"])("rejects %j", (input) => {
    expect(normalizeHexColor(input)).toBeNull();
    expect(hexColorSchema.safeParse(input).success).toBe(false);
  });
});

describe("plan flag", () => {
  it("only Pro has custom colors", () => {
    expect(PLAN_LIMITS.basic.customColors).toBe(false);
    expect(PLAN_LIMITS.pro.customColors).toBe(true);
  });
});
