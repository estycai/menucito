import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { restaurantMembers, rolePermissions, roles, user, type MemberRow, type NewMemberRow, type RoleRow } from "../db/schema";
import { translatingUniqueViolations } from "./errors";

/** A member with its role and the email of its account. */
export interface MemberRecord {
  member: MemberRow;
  role: Pick<RoleRow, "id" | "name" | "active" | "isSystem">;
  email: string;
}

/** What the access middleware needs: the member, its role and the permission keys the role stores. */
export interface MemberAccessRecord {
  member: MemberRow;
  role: RoleRow;
  /** Raw stored keys; the caller normalizes them (a key that left the catalog is ignored). */
  permissions: string[];
}

export interface ListMembersFilter {
  page: number;
  limit: number;
  courier?: boolean;
  active?: boolean;
}

export interface MemberChanges {
  firstName?: string;
  lastName?: string;
  /** `null` clears the phone. */
  phone?: string | null;
  roleId?: string;
  isCourier?: boolean;
  active?: boolean;
}

/** `restaurant_members` rows. Everything but `findAccessByUserId` is scoped by `restaurantId`. */
export interface MembersRepository {
  /**
   * Entry point of every request: the membership of the signed-in user (there is at most one) with
   * its role and permission keys. `null` when the user has no restaurant.
   */
  findAccessByUserId(userId: string): Promise<MemberAccessRecord | null>;
  /** Owner first, then by name; also returns the total for the page. */
  list(restaurantId: string, filter: ListMembersFilter): Promise<{ records: MemberRecord[]; total: number }>;
  find(restaurantId: string, id: string): Promise<MemberRecord | null>;
  /** Throws `UniqueViolationError` when the user is already a member. */
  insert(row: NewMemberRow): Promise<MemberRecord>;
  /** Applies `changes`; `null` when the member does not exist in the restaurant. */
  update(restaurantId: string, id: string, changes: MemberChanges, updatedAt: Date): Promise<MemberRecord | null>;
  /** Deletes the member row; `false` when it does not exist in the restaurant. */
  delete(restaurantId: string, id: string): Promise<boolean>;
}

export function createMembersRepository(d1: D1Database): MembersRepository {
  const db = drizzle(d1);

  const selectRecords = () =>
    db
      .select({
        member: restaurantMembers,
        role: { id: roles.id, name: roles.name, active: roles.active, isSystem: roles.isSystem },
        email: user.email,
      })
      .from(restaurantMembers)
      .innerJoin(roles, eq(roles.id, restaurantMembers.roleId))
      .innerJoin(user, eq(user.id, restaurantMembers.userId));

  async function find(restaurantId: string, id: string): Promise<MemberRecord | null> {
    const found = await selectRecords()
      .where(and(eq(restaurantMembers.restaurantId, restaurantId), eq(restaurantMembers.id, id)))
      .get();
    return found ?? null;
  }

  return {
    async findAccessByUserId(userId) {
      const found = await db
        .select({ member: restaurantMembers, role: roles })
        .from(restaurantMembers)
        .innerJoin(roles, eq(roles.id, restaurantMembers.roleId))
        .where(eq(restaurantMembers.userId, userId))
        .get();
      if (!found) return null;
      const stored = await db
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, found.role.id))
        .all();
      return { ...found, permissions: stored.map((row) => row.permission) };
    },

    async list(restaurantId, filter) {
      const conditions: SQL[] = [eq(restaurantMembers.restaurantId, restaurantId)];
      if (filter.courier !== undefined) conditions.push(eq(restaurantMembers.isCourier, filter.courier));
      if (filter.active !== undefined) conditions.push(eq(restaurantMembers.active, filter.active));
      const where = and(...conditions);

      const [records, counted] = await Promise.all([
        selectRecords()
          .where(where)
          .orderBy(
            desc(restaurantMembers.isOwner),
            asc(sql`lower(${restaurantMembers.firstName})`),
            asc(sql`lower(${restaurantMembers.lastName})`),
            asc(restaurantMembers.id),
          )
          .limit(filter.limit)
          .offset((filter.page - 1) * filter.limit)
          .all(),
        db.select({ total: sql<number>`count(*)` }).from(restaurantMembers).where(where).get(),
      ]);
      return { records, total: counted?.total ?? 0 };
    },

    find,

    async insert(row) {
      await translatingUniqueViolations(() => db.insert(restaurantMembers).values(row).run());
      const inserted = await find(row.restaurantId, row.id);
      if (!inserted) throw new Error("Member disappeared right after insert");
      return inserted;
    },

    async update(restaurantId, id, changes, updatedAt) {
      const written = await db
        .update(restaurantMembers)
        .set({ ...changes, updatedAt })
        .where(and(eq(restaurantMembers.restaurantId, restaurantId), eq(restaurantMembers.id, id)))
        .returning({ id: restaurantMembers.id })
        .get();
      return written ? find(restaurantId, id) : null;
    },

    async delete(restaurantId, id) {
      const deleted = await db
        .delete(restaurantMembers)
        .where(and(eq(restaurantMembers.restaurantId, restaurantId), eq(restaurantMembers.id, id)))
        .returning({ id: restaurantMembers.id })
        .get();
      return deleted !== undefined;
    },
  };
}
