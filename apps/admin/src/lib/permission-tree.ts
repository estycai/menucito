import { PERMISSION_SECTIONS, normalizePermissions, type PermissionKey, type PermissionSection } from "@menucito/shared";

/**
 * Checking logic of the permission list of a role. The rules (spec 12, decision 2 and scenario 51):
 * a sub-permission only counts with its section, so checking one checks the section and unchecking
 * the section unchecks every sub-permission. The result is always normalized (catalog order).
 */
export function togglePermission(selected: readonly PermissionKey[], key: PermissionKey): PermissionKey[] {
  const next = new Set<string>(selected);
  const section = PERMISSION_SECTIONS.find(
    (candidate) => candidate.key === key || candidate.subpermissions.some((sub) => sub.key === key),
  );
  if (!section) return normalizePermissions(selected);

  if (next.has(key)) {
    next.delete(key);
    // Unchecking a section takes its sub-permissions with it.
    if (key === section.key) for (const sub of section.subpermissions) next.delete(sub.key);
  } else {
    next.add(key);
    // Checking a sub-permission checks its section.
    next.add(section.key);
  }
  return normalizePermissions([...next]);
}

export interface SectionState {
  checked: boolean;
  /** How many sub-permissions are checked. */
  checkedCount: number;
  totalCount: number;
  /** "2 de 3" when some sub-permissions are checked; `null` otherwise (and for sections without any). */
  summary: string | null;
}

export function sectionState(selected: readonly PermissionKey[], section: PermissionSection): SectionState {
  const chosen = new Set<string>(selected);
  const checkedCount = section.subpermissions.filter((sub) => chosen.has(sub.key)).length;
  const totalCount = section.subpermissions.length;
  return {
    checked: chosen.has(section.key),
    checkedCount,
    totalCount,
    summary: totalCount > 0 && checkedCount > 0 ? `${checkedCount} de ${totalCount}` : null,
  };
}
