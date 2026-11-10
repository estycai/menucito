import {
  PERMISSION_SECTIONS,
  childKeysOf,
  normalizePermissions,
  parentOf,
  type PermissionDefinition,
  type PermissionGroup,
  type PermissionKey,
  type PermissionSection,
} from "@menucito/shared";

/** Every key below `key` (a section's sub-permissions, a tab's blocks). */
function descendants(key: PermissionKey): PermissionKey[] {
  return childKeysOf(key).flatMap((child) => [child, ...descendants(child)]);
}

/**
 * Checking logic of the permission list of a role. A key counts only with its whole chain, so checking
 * a block checks its tab and `stats.view`; unchecking a tab or a section takes its children with it.
 * The result is always normalized (catalog order).
 */
export function togglePermission(selected: readonly PermissionKey[], key: PermissionKey): PermissionKey[] {
  const next = new Set<string>(selected);
  if (next.has(key)) {
    next.delete(key);
    for (const child of descendants(key)) next.delete(child);
  } else {
    next.add(key);
    let parent = parentOf(key);
    while (parent) {
      next.add(parent);
      parent = parentOf(parent);
    }
  }
  return normalizePermissions([...next]);
}

export interface SectionState {
  checked: boolean;
  /** How many sub-permissions are checked, at every level (a Reports tab and each of its blocks count). */
  checkedCount: number;
  totalCount: number;
  /** "27 de 47" when some leaves are checked; `null` otherwise (and for sections without any). */
  summary: string | null;
}

function sectionKeys(entries: readonly (PermissionDefinition | PermissionGroup)[]): string[] {
  return entries.flatMap((entry) => [entry.key, ...("children" in entry ? sectionKeys(entry.children) : [])]);
}

export function sectionState(selected: readonly PermissionKey[], section: PermissionSection): SectionState {
  const chosen = new Set<string>(selected);
  const keys = sectionKeys(section.subpermissions);
  const checkedCount = keys.filter((key) => chosen.has(key)).length;
  const totalCount = keys.length;
  return {
    checked: chosen.has(section.key),
    checkedCount,
    totalCount,
    summary: totalCount > 0 && checkedCount > 0 ? `${checkedCount} de ${totalCount}` : null,
  };
}

/** Number of keys of the whole catalog (tabs included), for the tree's total. */
export const PERMISSION_LEAF_COUNT = PERMISSION_SECTIONS.reduce(
  (sum, section) => sum + sectionKeys(section.subpermissions).length,
  0,
);
