import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { restaurantMembers, rolePermissions, roles, type NewRoleRow, type RoleRow } from "../db/schema";
import { translatingForeignKeyViolations, translatingUniqueViolations } from "./errors";

/** A role with how many members use it and the permission keys it stores. */
export interface RoleRecord {
  role: RoleRow;
  memberCount: number;
  /** Raw stored keys; the caller normalizes them. */
  permissions: string[];
}

export interface RoleChanges {
  name?: string;
  active?: boolean;
}

/** `roles` and `role_permissions` rows. Every method is scoped by `restaurantId`. */
export interface RolesRepository {
  /** The system role first, then by name. */
  list(restaurantId: string): Promise<RoleRecord[]>;
  find(restaurantId: string, id: string): Promise<RoleRecord | null>;
  /** Inserts the role and its permission rows in one batch. Throws `UniqueViolationError` on a repeated name. */
  insert(row: NewRoleRow, permissions: readonly string[]): Promise<RoleRecord>;
  /**
   * Applies `changes` and, when `permissions` is given, replaces the stored keys, all in one batch.
   * Throws `UniqueViolationError` on a repeated name. `null` when the role is not in the restaurant.
   */
  update(
    restaurantId: string,
    id: string,
    changes: RoleChanges,
    permissions: readonly string[] | undefined,
    updatedAt: Date,
  ): Promise<RoleRecord | null>;
  /** Deletes the role (its permission rows go with it). Throws `ForeignKeyViolationError` while members use it. */
  delete(restaurantId: string, id: string): Promise<boolean>;
}

export function createRolesRepository(d1: D1Database): RolesRepository {
  const db = drizzle(d1);

  async function load(restaurantId: string, onlyId?: string): Promise<RoleRecord[]> {
    const scope = onlyId
      ? and(eq(roles.restaurantId, restaurantId), eq(roles.id, onlyId))
      : eq(roles.restaurantId, restaurantId);
    const rows = await db
      .select()
      .from(roles)
      .where(scope)
      .orderBy(desc(roles.isSystem), asc(sql`lower(${roles.name})`), asc(roles.id))
      .all();
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    const [counts, stored] = await Promise.all([
      db
        .select({ roleId: restaurantMembers.roleId, count: sql<number>`count(*)` })
        .from(restaurantMembers)
        .where(and(eq(restaurantMembers.restaurantId, restaurantId), inArray(restaurantMembers.roleId, ids)))
        .groupBy(restaurantMembers.roleId)
        .all(),
      db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, ids)).all(),
    ]);
    const countByRole = new Map(counts.map((row) => [row.roleId, row.count]));
    const keysByRole = new Map<string, string[]>();
    for (const row of stored) {
      const keys = keysByRole.get(row.roleId) ?? [];
      keys.push(row.permission);
      keysByRole.set(row.roleId, keys);
    }
    return rows.map((role) => ({
      role,
      memberCount: countByRole.get(role.id) ?? 0,
      permissions: keysByRole.get(role.id) ?? [],
    }));
  }

  async function find(restaurantId: string, id: string): Promise<RoleRecord | null> {
    return (await load(restaurantId, id))[0] ?? null;
  }

  type BatchStatement = Parameters<typeof db.batch>[0][number];

  const permissionRows = (roleId: string, permissions: readonly string[]) =>
    permissions.map((permission) => ({ roleId, permission }));

  return {
    list: (restaurantId) => load(restaurantId),

    find,

    async insert(row, permissions) {
      const statements: BatchStatement[] = [db.insert(roles).values(row)];
      const rows = permissionRows(row.id, permissions);
      if (rows.length > 0) statements.push(db.insert(rolePermissions).values(rows));
      await translatingUniqueViolations(() => db.batch(statements as [BatchStatement, ...BatchStatement[]]));
      const inserted = await find(row.restaurantId, row.id);
      if (!inserted) throw new Error("Role disappeared right after insert");
      return inserted;
    },

    async update(restaurantId, id, changes, permissions, updatedAt) {
      const current = await find(restaurantId, id);
      if (!current) return null;
      const statements: BatchStatement[] = [
        db
          .update(roles)
          .set({ ...changes, updatedAt })
          .where(and(eq(roles.restaurantId, restaurantId), eq(roles.id, id))),
      ];
      if (permissions !== undefined) {
        statements.push(db.delete(rolePermissions).where(eq(rolePermissions.roleId, id)));
        const rows = permissionRows(id, permissions);
        if (rows.length > 0) statements.push(db.insert(rolePermissions).values(rows));
      }
      await translatingUniqueViolations(() => db.batch(statements as [BatchStatement, ...BatchStatement[]]));
      return find(restaurantId, id);
    },

    async delete(restaurantId, id) {
      const deleted = await translatingForeignKeyViolations(() =>
        db
          .delete(roles)
          .where(and(eq(roles.restaurantId, restaurantId), eq(roles.id, id)))
          .returning({ id: roles.id })
          .get(),
      );
      return deleted !== undefined;
    },
  };
}
