/**
 * Menu theme: the owner picks two colors (page background and primary) and every other color is
 * derived here, so any combination is readable. Pure functions with no DOM or React: the public
 * menu (web) and the live preview (admin) run the exact same code, and Vitest proves the contrast
 * guarantees.
 */

/** The two colors an owner can choose, both `#RRGGBB`. */
export interface ThemeColors {
  background: string;
  primary: string;
}

/** Menucito's own colors, used when the owner picked none (or the plan has no custom colors). */
export const DEFAULT_COLORS: Readonly<ThemeColors> = { background: "#F7F5F2", primary: "#C2410C" };

/** Minimum contrast ratio for text (WCAG AA, normal size). */
const TEXT_CONTRAST = 4.5;
/** Minimum contrast between the primary color and the background so the primary stays visible. */
const COMPONENT_CONTRAST = 3;

const WHITE = "#FFFFFF";
const NEAR_BLACK = "#1C1917";
const BLACK = "#000000";

const HEX_PATTERN = /^(?:[0-9A-F]{3}|[0-9A-F]{6})$/;

/**
 * Reads `#RGB`, `#RRGGBB`, `RGB` or `RRGGBB` (any case, surrounding spaces ignored) and returns
 * `#RRGGBB` in uppercase, or `null` when the input is not a hex color.
 */
export function normalizeHexColor(input: string): string | null {
  const digits = input.trim().replace(/^#/, "").toUpperCase();
  if (!HEX_PATTERN.test(digits)) return null;
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
  return `#${full}`;
}

type Rgb = readonly [number, number, number];

function toRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Linear mix in sRGB: `0` is `a`, `1` is `b`. */
function mix(a: string, b: string, t: number): string {
  const from = toRgb(a);
  const to = toRgb(b);
  return toHex([0, 1, 2].map((i) => Math.round((from[i] ?? 0) * (1 - t) + (to[i] ?? 0) * t)) as unknown as Rgb);
}

/** WCAG relative luminance of a `#RRGGBB` color. */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#RRGGBB` colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const passes = (foreground: string, ...backgrounds: string[]) =>
  backgrounds.every((background) => contrastRatio(foreground, background) >= TEXT_CONTRAST);

/**
 * Moves `from` toward `to` in steps of 0.1 and returns the first mix that reads on every background.
 * `to` must read on them itself, so the walk always ends (the last step is `to`).
 */
function walkUntilReadable(from: string, to: string, backgrounds: string[]): string {
  for (let step = 0; step < 10; step++) {
    const candidate = mix(from, to, step / 10);
    if (passes(candidate, ...backgrounds)) return candidate;
  }
  return to;
}

/** Problem found in a pair of colors; `null` means the pair is usable. */
export type ColorsProblem = "contrast";

/**
 * Rejects the one unusable combination: a primary color that is too close to the background
 * (under 3:1), which would make buttons vanish into the page. Everything else is made readable by
 * `themeFromColors`.
 */
export function colorsProblem(colors: ThemeColors): ColorsProblem | null {
  return contrastRatio(colors.primary, colors.background) < COMPONENT_CONTRAST ? "contrast" : null;
}

/** Every color the menu paints with, all `#RRGGBB`. See `themeFromColors` for the guarantees. */
export interface Theme {
  background: string;
  /** Main text color. */
  ink: string;
  /** Background of cards, sheets and fields. */
  surface: string;
  /** Secondary text. */
  muted: string;
  /** The owner's primary color, untouched: fills for buttons and active chips. */
  primary: string;
  /** Text and icons placed on a `primary` fill. */
  onPrimary: string;
  /** The primary color adjusted to be readable as text, icon or thin line on the page. */
  accent: string;
  /** Error text. */
  danger: string;
  /** Borders and separators. */
  line: string;
  /** Inactive chips and subtle fills. */
  tab: string;
  /** Soft primary tone for highlighted rows; `ink` reads on it. */
  primarySoft: string;
  /** Hover/pressed state of a `primary` fill. */
  primaryHover: string;
  /** Slightly tinted background of option rows (ingredient add-ons), drawn on the surface. */
  addon: string;
  /** Cover strip color when the restaurant has no cover image. */
  coverFallback: string;
}

/**
 * Derives the whole theme from the two owner colors (assumed valid `#RRGGBB`). Guarantees 4.5:1
 * for ink, muted, accent and danger against the background and the surface, for `onPrimary`
 * against `primary` and for ink on `primarySoft`. The primary fill itself is never modified.
 */
export function themeFromColors(colors: ThemeColors): Theme {
  const background = colors.background;
  const primary = colors.primary;

  const ink = [NEAR_BLACK, WHITE, BLACK].find((candidate) => passes(candidate, background)) ?? BLACK;
  const inkIsDark = ink !== WHITE;
  // A light ink needs cards darker than the page, so it also reads on them.
  const surface = inkIsDark ? WHITE : mix(background, BLACK, 0.35);
  const addon = mix(surface, ink, 0.04);

  const muted = walkUntilReadable(mix(ink, background, 0.3), ink, [background, surface, addon]);
  const onPrimary = [WHITE, NEAR_BLACK, BLACK].find((candidate) => passes(candidate, primary)) ?? BLACK;
  const accent = walkUntilReadable(primary, ink, [background, surface]);
  const danger =
    ["#B91C1C", "#FCA5A5"].find((candidate) => passes(candidate, background, surface)) ??
    walkUntilReadable("#B91C1C", ink, [background, surface]);

  const softCandidate = mix(surface, primary, 0.12);
  const hoverCandidate = mix(primary, onPrimary, 0.12);

  return {
    background,
    ink,
    surface,
    muted,
    primary,
    onPrimary,
    accent,
    danger,
    line: mix(background, ink, 0.12),
    tab: mix(background, ink, 0.08),
    primarySoft: passes(ink, softCandidate) ? softCandidate : surface,
    primaryHover: contrastRatio(onPrimary, hoverCandidate) >= TEXT_CONTRAST ? hoverCandidate : primary,
    addon,
    coverFallback: mix(background, primary, 0.25),
  };
}

/** CSS custom properties of `theme`, as declarations for a `style` attribute (`--color-bg: #F7F5F2; ...`). */
export function themeCssVars(theme: Theme): string {
  const vars: Record<string, string> = {
    "--color-bg": theme.background,
    "--color-ink": theme.ink,
    "--color-surface": theme.surface,
    "--color-muted": theme.muted,
    "--color-primary": theme.primary,
    "--color-on-primary": theme.onPrimary,
    "--color-primary-hover": theme.primaryHover,
    "--color-link": theme.accent,
    "--color-danger": theme.danger,
    "--color-line": theme.line,
    "--color-tab": theme.tab,
    "--color-primary-soft": theme.primarySoft,
    "--color-nav-active": theme.primarySoft,
    "--color-addon": theme.addon,
    "--color-cover": theme.coverFallback,
  };
  return Object.entries(vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
}
