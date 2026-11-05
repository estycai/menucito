import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "./auth";
import { normalizeArWhatsapp } from "./restaurant";

/**
 * Permission catalog. A permission is a text key `<section>.<action>`; every section has a
 * `<section>.view` key and its sub-permissions hang from it (a sub-permission only counts when its
 * section is checked too). Roles store the keys they grant, so adding a key here needs no migration;
 * a stored key that is no longer in the catalog is ignored when read (`normalizePermissions`).
 *
 * "Users" and "Plan and billing" are deliberately not permissions: they are owner-only.
 */
export interface PermissionDefinition {
  key: string;
  label: string;
}

export interface PermissionSection extends PermissionDefinition {
  /** Sub-permissions of the section, in display order. */
  subpermissions: readonly PermissionDefinition[];
}

/** Sections in the order of the admin menu. */
export const PERMISSION_SECTIONS = [
  { key: "summary.view", label: "Resumen", subpermissions: [] },
  {
    key: "orders.view",
    label: "Pedidos",
    subpermissions: [
      { key: "orders.status", label: "Cambiar estado y cancelar" },
      { key: "orders.payment", label: "Marcar pagado o pendiente" },
      { key: "orders.export", label: "Exportar a CSV" },
      { key: "orders.assign", label: "Asignar repartidor" },
    ],
  },
  { key: "couriers.view", label: "Repartidores", subpermissions: [] },
  {
    key: "menu.view",
    label: "Mi menú",
    subpermissions: [{ key: "menu.edit", label: "Crear, editar, borrar y ordenar" }],
  },
  {
    key: "store.view",
    label: "Mi local",
    subpermissions: [{ key: "store.edit", label: "Editar datos, apariencia, horarios, envío, pagos y pausa" }],
  },
  { key: "qr.view", label: "Link y QR", subpermissions: [] },
  { key: "stats.view", label: "Estadísticas", subpermissions: [] },
] as const satisfies readonly PermissionSection[];

type SectionOf = (typeof PERMISSION_SECTIONS)[number];

export type PermissionSectionKey = SectionOf["key"];
export type PermissionKey = SectionOf["key"] | SectionOf["subpermissions"][number]["key"];

/** Every key of the catalog in catalog order (each section followed by its sub-permissions). */
export const ALL_PERMISSIONS: readonly PermissionKey[] = PERMISSION_SECTIONS.flatMap((section) => [
  section.key,
  ...section.subpermissions.map((sub) => sub.key),
]);

const PERMISSION_ORDER = new Map<string, number>(ALL_PERMISSIONS.map((key, index) => [key, index]));

const SECTION_KEYS: ReadonlySet<string> = new Set(PERMISSION_SECTIONS.map((section) => section.key));

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && PERMISSION_ORDER.has(value);
}

/** The section key (`<section>.view`) a permission hangs from; a section key is its own section. */
export function sectionKeyOf(key: PermissionKey): PermissionSectionKey {
  if (SECTION_KEYS.has(key)) return key as PermissionSectionKey;
  const prefix = key.split(".")[0];
  return `${prefix}.view` as PermissionSectionKey;
}

/** Drops unknown keys and repeated ones; the result follows the catalog order. */
export function normalizePermissions(keys: readonly string[]): PermissionKey[] {
  const wanted = new Set(keys);
  return ALL_PERMISSIONS.filter((key) => wanted.has(key));
}

export interface PermissionProblem {
  /** The sub-permission that has no section checked. */
  permission: PermissionKey;
  /** The section key that is missing. */
  missing: PermissionSectionKey;
  message: string;
}

export const PERMISSION_MESSAGES = {
  missingSection: (permission: string, missing: string) =>
    `El permiso ${permission} necesita que también esté marcado ${missing}`,
} as const;

/** Checks that every sub-permission comes with its section key; `null` when the list is valid. */
export function validatePermissions(keys: readonly string[]): PermissionProblem | null {
  const known = normalizePermissions(keys);
  const present = new Set<string>(known);
  for (const key of known) {
    const section = sectionKeyOf(key);
    if (!present.has(section)) {
      return { permission: key, missing: section, message: PERMISSION_MESSAGES.missingSection(key, section) };
    }
  }
  return null;
}

/** What the API tells the admin about the signed-in member (`access` of `GET /api/restaurants/me`). */
export interface Access {
  memberId: string;
  isOwner: boolean;
  /** `true` when the member is marked as a courier (`is_courier`). */
  isCourier: boolean;
  /** `false` when the owner deactivated the user. */
  active: boolean;
  role: { id: string; name: string; active: boolean };
  /** Normalized keys; for the owner, every key of the catalog. Empty when the role is inactive. */
  permissions: PermissionKey[];
}

/** The part of `Access` that decides a permission check. */
export interface PermissionSubject {
  isOwner: boolean;
  active: boolean;
  permissions: readonly PermissionKey[];
  role: { active: boolean };
}

/** The owner has every permission; an inactive member or one with an inactive role has none. */
export function hasPermission(access: PermissionSubject, key: PermissionKey): boolean {
  if (!access.active) return false;
  if (access.isOwner) return true;
  if (!access.role.active) return false;
  return access.permissions.includes(key);
}

// ---------------------------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------------------------

export const ROLE_NAME_MAX_LENGTH = 40;
/** Name of the system role of every restaurant (the owner's). Nobody can create another with it. */
export const OWNER_ROLE_NAME = "Dueño";

export const ROLE_MESSAGES = {
  nameRequired: "Ingresá el nombre del rol",
  nameTooLong: `El nombre puede tener hasta ${ROLE_NAME_MAX_LENGTH} caracteres`,
  nameReserved: `El nombre ${OWNER_ROLE_NAME} está reservado para el dueño del local`,
  updateEmpty: "Enviá al menos un cambio",
} as const;

const roleNameSchema = z
  .string(ROLE_MESSAGES.nameRequired)
  .trim()
  .min(1, ROLE_MESSAGES.nameRequired)
  .max(ROLE_NAME_MAX_LENGTH, ROLE_MESSAGES.nameTooLong)
  .refine((name) => name.toLowerCase() !== OWNER_ROLE_NAME.toLowerCase(), ROLE_MESSAGES.nameReserved);

/** Unknown keys are dropped; a sub-permission without its section is an error naming the missing key. */
const permissionListSchema = z
  .array(z.string())
  .transform((keys) => normalizePermissions(keys))
  .superRefine((keys, ctx) => {
    const problem = validatePermissions(keys);
    if (problem) ctx.addIssue({ code: "custom", message: problem.message });
  });

/** Body of `POST /api/roles`. */
export const roleSchema = z.object({
  name: roleNameSchema,
  permissions: permissionListSchema,
});

export type RoleInput = z.infer<typeof roleSchema>;

/** Body of `PATCH /api/roles/:id`: any subset of the keys. */
export const updateRoleSchema = z
  .object({
    name: roleNameSchema.optional(),
    permissions: permissionListSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: ROLE_MESSAGES.updateEmpty,
  });

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/** A role as the API returns it. */
export interface Role {
  id: string;
  name: string;
  /** The owner's role: cannot be edited, deactivated or deleted. */
  isSystem: boolean;
  active: boolean;
  memberCount: number;
  /** Normalized keys; empty for the system role (the owner has everything). */
  permissions: PermissionKey[];
}

// ---------------------------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------------------------

export const MEMBER_NAME_MAX_LENGTH = 60;
export const MEMBER_PASSWORD_MAX_LENGTH = 128;
export const DEFAULT_PHONE_PREFIX = "+54";
export const MEMBER_PAGE_SIZE = 20;
export const MEMBER_PAGE_SIZE_MAX = 100;

const PHONE_PREFIX_PATTERN = /^\+\d{1,3}$/;
const PHONE_DIGITS_MIN = 6;
const PHONE_DIGITS_MAX = 14;

export const MEMBER_MESSAGES = {
  firstNameRequired: "Ingresá el nombre",
  lastNameRequired: "Ingresá el apellido",
  nameTooLong: `Puede tener hasta ${MEMBER_NAME_MAX_LENGTH} caracteres`,
  emailRequired: "Ingresá el email",
  emailInvalid: "Email inválido",
  passwordTooShort: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
  passwordTooLong: `La contraseña puede tener hasta ${MEMBER_PASSWORD_MAX_LENGTH} caracteres`,
  roleRequired: "Elegí un rol",
  phoneInvalid: "Teléfono inválido",
  phonePrefixInvalid: "Prefijo inválido, por ejemplo +54",
  pageInvalid: "Página inválida",
  limitInvalid: "Límite inválido",
  flagInvalid: "Valor inválido, usá true o false",
} as const;

/**
 * Phone of a member in E.164 (`+5491112345678`), or `null` when it is not valid. With `+54` the number
 * goes through `normalizeArWhatsapp`; with any other prefix it needs 6 to 14 digits.
 */
export function normalizeMemberPhone(prefix: string, number: string): string | null {
  const cleanPrefix = prefix.replace(/\s/g, "");
  if (!PHONE_PREFIX_PATTERN.test(cleanPrefix)) return null;
  if (cleanPrefix === DEFAULT_PHONE_PREFIX) {
    const arPhone = normalizeArWhatsapp(number);
    return arPhone ? `+${arPhone}` : null;
  }
  const digits = number.replace(/\D/g, "");
  if (digits.length < PHONE_DIGITS_MIN || digits.length > PHONE_DIGITS_MAX) return null;
  return `${cleanPrefix}${digits}`;
}

const personNameSchema = (required: string) =>
  z.string(required).trim().min(1, required).max(MEMBER_NAME_MAX_LENGTH, MEMBER_MESSAGES.nameTooLong);

const memberEmailSchema = z
  .string(MEMBER_MESSAGES.emailRequired)
  .trim()
  .toLowerCase()
  .min(1, MEMBER_MESSAGES.emailRequired)
  .email(MEMBER_MESSAGES.emailInvalid);

/** Password the owner sets for a member (8 to 128 characters). */
export const memberPasswordSchema = z
  .string(MEMBER_MESSAGES.passwordTooShort)
  .min(MIN_PASSWORD_LENGTH, MEMBER_MESSAGES.passwordTooShort)
  .max(MEMBER_PASSWORD_MAX_LENGTH, MEMBER_MESSAGES.passwordTooLong);

/** Body of `PUT /api/members/:id/password`. */
export const setMemberPasswordSchema = z.object({ password: memberPasswordSchema });

export type SetMemberPasswordInput = z.infer<typeof setMemberPasswordSchema>;

/** Body of `PATCH /api/members/:id/active`. */
export const setMemberActiveSchema = z.object({ active: z.boolean() });

export type SetMemberActiveInput = z.infer<typeof setMemberActiveSchema>;

const phoneFields = {
  /** Defaults to `+54`. */
  phonePrefix: z.string().optional(),
  /** Blank or `null` means "no phone". */
  phone: z.string().nullable().optional(),
};

/**
 * Combines `phonePrefix` and `phone` into one E.164 string on `phone`. `undefined` (no phone sent)
 * stays `undefined`; blank or `null` becomes `null`.
 */
function resolvePhone<T extends { phonePrefix?: string | undefined; phone?: string | null | undefined }>(
  value: T,
  ctx: z.RefinementCtx<T>,
): string | null | undefined {
  if (value.phone === undefined) return undefined;
  if (value.phone === null || value.phone.trim() === "") return null;
  const prefix = (value.phonePrefix ?? DEFAULT_PHONE_PREFIX).trim() || DEFAULT_PHONE_PREFIX;
  if (!PHONE_PREFIX_PATTERN.test(prefix.replace(/\s/g, ""))) {
    ctx.addIssue({ code: "custom", message: MEMBER_MESSAGES.phonePrefixInvalid, path: ["phonePrefix"] });
    return undefined;
  }
  const phone = normalizeMemberPhone(prefix, value.phone);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: MEMBER_MESSAGES.phoneInvalid, path: ["phone"] });
    return undefined;
  }
  return phone;
}

/** The input fields `phonePrefix` and `phone` are replaced by the single E.164 `phone` of the output. */
function withoutPhoneInput<T extends { phonePrefix?: unknown; phone?: unknown }>(value: T): Omit<T, "phonePrefix" | "phone"> {
  const copy = { ...value };
  delete copy.phonePrefix;
  delete copy.phone;
  return copy;
}

/** Body of `POST /api/members`. The output `phone` is E.164 or `null`; `phonePrefix` is consumed. */
export const createMemberSchema = z
  .object({
    firstName: personNameSchema(MEMBER_MESSAGES.firstNameRequired),
    lastName: personNameSchema(MEMBER_MESSAGES.lastNameRequired),
    email: memberEmailSchema,
    password: memberPasswordSchema,
    roleId: z.string(MEMBER_MESSAGES.roleRequired).min(1, MEMBER_MESSAGES.roleRequired),
    isCourier: z.boolean().default(false),
    ...phoneFields,
  })
  .transform((value, ctx) => {
    return { ...withoutPhoneInput(value), phone: resolvePhone(value, ctx) ?? null };
  });

export type CreateMemberInput = z.infer<typeof createMemberSchema>;

/**
 * Body of `PATCH /api/members/:id`: like creation without email or password (sending either is an
 * error). The output `phone` is `undefined` (leave as is), `null` (clear) or E.164.
 */
export const updateMemberSchema = z
  .strictObject({
    firstName: personNameSchema(MEMBER_MESSAGES.firstNameRequired).optional(),
    lastName: personNameSchema(MEMBER_MESSAGES.lastNameRequired).optional(),
    roleId: z.string(MEMBER_MESSAGES.roleRequired).min(1, MEMBER_MESSAGES.roleRequired).optional(),
    isCourier: z.boolean().optional(),
    ...phoneFields,
  })
  .transform((value, ctx) => {
    const rest = withoutPhoneInput(value);
    const phone = resolvePhone(value, ctx);
    return phone === undefined ? rest : { ...rest, phone };
  });

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/** A member as the API returns it (never the password). */
export interface Member {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  /** E.164, or `null` when there is none. */
  phone: string | null;
  role: { id: string; name: string; active: boolean };
  isCourier: boolean;
  isOwner: boolean;
  active: boolean;
  createdAt: string;
}

export interface MemberList {
  members: Member[];
  page: number;
  limit: number;
  total: number;
}

const optionalParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const flagParam = optionalParam(
  z
    .enum(["true", "false"], MEMBER_MESSAGES.flagInvalid)
    .transform((value) => value === "true"),
);

/** Query of `GET /api/members`: `courier` and `active` filter when present. */
export const memberListQuerySchema = z.object({
  page: optionalParam(z.coerce.number(MEMBER_MESSAGES.pageInvalid).int(MEMBER_MESSAGES.pageInvalid).positive(MEMBER_MESSAGES.pageInvalid)).transform(
    (page) => page ?? 1,
  ),
  limit: optionalParam(
    z.coerce
      .number(MEMBER_MESSAGES.limitInvalid)
      .int(MEMBER_MESSAGES.limitInvalid)
      .positive(MEMBER_MESSAGES.limitInvalid)
      .max(MEMBER_PAGE_SIZE_MAX, MEMBER_MESSAGES.limitInvalid),
  ).transform((limit) => limit ?? MEMBER_PAGE_SIZE),
  courier: flagParam,
  active: flagParam,
});

export type MemberListQuery = z.infer<typeof memberListQuerySchema>;
