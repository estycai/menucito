import { type Role, type RoleInput, type UpdateRoleInput, normalizePermissions } from "@menucito/shared";
import { ForeignKeyViolationError, UniqueViolationError } from "../repositories/errors";
import { createRolesRepository, type RoleRecord, type RolesRepository } from "../repositories/roles";
import { RoleInUseError, RoleNameTakenError, RoleNotFoundError, SystemRoleError } from "./errors";

/** Name of the unique index on `(restaurant_id, lower(name))`. */
const ROLE_NAME_UNIQUE_INDEX = "roles_restaurant_name_unique";

function toRole({ role, memberCount, permissions }: RoleRecord): Role {
  return {
    id: role.id,
    name: role.name,
    isSystem: role.isSystem,
    active: role.active,
    memberCount,
    // The system role stores no keys (the owner check grants everything).
    permissions: role.isSystem ? [] : normalizePermissions(permissions),
  };
}

function translateNameTaken(error: unknown): never {
  if (error instanceof UniqueViolationError && error.column === ROLE_NAME_UNIQUE_INDEX) throw new RoleNameTakenError();
  throw error;
}

export interface RolesDependencies {
  roles: RolesRepository;
  now?: () => Date;
  generateId?: () => string;
}

/** Roles of a restaurant (owner only). Inputs must already be validated with the shared schemas. */
export function createRolesService({ roles, now = () => new Date(), generateId = () => crypto.randomUUID() }: RolesDependencies) {
  async function editableRole(restaurantId: string, id: string): Promise<RoleRecord> {
    const record = await roles.find(restaurantId, id);
    if (!record) throw new RoleNotFoundError();
    if (record.role.isSystem) throw new SystemRoleError();
    return record;
  }

  return {
    async list(restaurantId: string): Promise<Role[]> {
      return (await roles.list(restaurantId)).map(toRole);
    },

    async create(restaurantId: string, input: RoleInput): Promise<Role> {
      const at = now();
      const record = await roles
        .insert(
          { id: generateId(), restaurantId, name: input.name, isSystem: false, active: true, createdAt: at, updatedAt: at },
          input.permissions,
        )
        .catch(translateNameTaken);
      return toRole(record);
    },

    /** Replaces the name and/or the whole permission list and/or the active flag, atomically. */
    async update(restaurantId: string, id: string, input: UpdateRoleInput): Promise<Role> {
      await editableRole(restaurantId, id);
      const changes = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      };
      const record = await roles.update(restaurantId, id, changes, input.permissions, now()).catch(translateNameTaken);
      if (!record) throw new RoleNotFoundError();
      return toRole(record);
    },

    /** Deletes a role nobody uses: with members it is a 409 carrying how many. */
    async remove(restaurantId: string, id: string): Promise<void> {
      const { memberCount } = await editableRole(restaurantId, id);
      if (memberCount > 0) throw new RoleInUseError(memberCount);
      try {
        if (!(await roles.delete(restaurantId, id))) throw new RoleNotFoundError();
      } catch (error) {
        // A member was assigned between the count and the delete (`restaurant_members.role_id` has no cascade).
        if (error instanceof ForeignKeyViolationError) {
          throw new RoleInUseError((await roles.find(restaurantId, id))?.memberCount ?? 1);
        }
        throw error;
      }
    },
  };
}

export type RolesService = ReturnType<typeof createRolesService>;

export function rolesServiceFor(db: D1Database): RolesService {
  return createRolesService({ roles: createRolesRepository(db) });
}
