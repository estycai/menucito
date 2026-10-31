import {
  DEFAULT_COLORS,
  RESTAURANT_MESSAGES,
  colorsProblem,
  normalizeHexColor,
  planLimitsFor,
  restaurantDescriptionSchema,
  type Restaurant,
  type ThemeColors,
  type UpdateAppearanceInput,
} from "@menucito/shared";

/** What the "Apariencia" form edits. Colors are free text (a swatch or a typed hex) until validated. */
export interface AppearanceValues {
  description: string;
  bgColor: string;
  primaryColor: string;
}

/** The unsaved state the live preview draws. */
export interface AppearanceDraft {
  description: string;
  colors: ThemeColors;
}

export interface AppearanceCheck {
  /** Only the keys that differ from what is saved; `null` when nothing changed. */
  changes: UpdateAppearanceInput | null;
  errors: { description?: string; bgColor?: string; primaryColor?: string };
  /** Advisories that never block saving (a low-contrast primary color). */
  warnings: { primaryColor?: string };
  /** Any error: saving is not allowed. Warnings do not count. */
  invalid: boolean;
}

/** Form values of a saved restaurant; a color never chosen shows the Menucito default. */
export function valuesFromRestaurant(restaurant: Restaurant): AppearanceValues {
  return {
    description: restaurant.description,
    bgColor: restaurant.bgColor ?? DEFAULT_COLORS.background,
    primaryColor: restaurant.primaryColor ?? DEFAULT_COLORS.primary,
  };
}

/** Whether the plan lets the owner choose colors. Read from the plan limits, never from the plan name. */
export function canCustomizeColors(restaurant: Restaurant): boolean {
  return planLimitsFor(restaurant.plan).customColors;
}

/**
 * Compares the form against the saved restaurant: the request body with only the changed keys and
 * the field errors. Colors are only looked at when `customColors` is on, so a Basic account never
 * sends a color key (the API answers 403 for any of them). A color equal to the default is sent as
 * `null` ("use Menucito's"), which is also how "Usar los colores de Menucito" resets. A primary
 * color too close to the background is only a warning: it is saved like any other.
 */
export function checkAppearance(saved: Restaurant, values: AppearanceValues, customColors: boolean): AppearanceCheck {
  const changes: UpdateAppearanceInput = {};
  const errors: AppearanceCheck["errors"] = {};
  const warnings: AppearanceCheck["warnings"] = {};

  const description = restaurantDescriptionSchema.safeParse(values.description);
  if (!description.success) {
    errors.description = description.error.issues[0]?.message;
  } else if (description.data !== saved.description) {
    changes.description = description.data;
  }

  if (customColors) {
    const background = normalizeHexColor(values.bgColor);
    const primary = normalizeHexColor(values.primaryColor);
    if (!background) errors.bgColor = RESTAURANT_MESSAGES.colorInvalid;
    if (!primary) errors.primaryColor = RESTAURANT_MESSAGES.colorInvalid;
    if (background && primary && colorsProblem({ background, primary })) {
      warnings.primaryColor = RESTAURANT_MESSAGES.colorContrast;
    }
    if (background && background !== (saved.bgColor ?? DEFAULT_COLORS.background)) {
      changes.bgColor = background === DEFAULT_COLORS.background ? null : background;
    }
    if (primary && primary !== (saved.primaryColor ?? DEFAULT_COLORS.primary)) {
      changes.primaryColor = primary === DEFAULT_COLORS.primary ? null : primary;
    }
  }

  return {
    changes: Object.keys(changes).length > 0 ? changes : null,
    errors,
    warnings,
    invalid: Object.keys(errors).length > 0,
  };
}

/**
 * Colors the preview draws: the draft ones on plans with custom colors (a half-typed hex keeps the
 * saved color), the Menucito defaults otherwise, like the public menu.
 */
export function draftColors(saved: Restaurant, values: AppearanceValues, customColors: boolean): ThemeColors {
  if (!customColors) return { ...DEFAULT_COLORS };
  return {
    background: normalizeHexColor(values.bgColor) ?? saved.bgColor ?? DEFAULT_COLORS.background,
    primary: normalizeHexColor(values.primaryColor) ?? saved.primaryColor ?? DEFAULT_COLORS.primary,
  };
}
