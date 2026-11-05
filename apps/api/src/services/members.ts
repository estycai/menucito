import type { CreateMemberInput, Member, MemberList, MemberListQuery, UpdateMemberInput } from "@menucito/shared";
import { createAuthAdmin, EmailAlreadyRegisteredError, type AuthAdmin } from "../auth-admin";
import type { Env } from "../env";
import { UniqueViolationError } from "../repositories/errors";
import { createMembersRepository, type MemberRecord, type MembersRepository } from "../repositories/members";
import { createRolesRepository, type RolesRepository } from "../repositories/roles";
import { EmailInUseError, MemberNotFoundError, OwnerImmutableError, ValidationError } from "./errors";

const fullName = (firstName: string, lastName: string) => `${firstName} ${lastName}`.trim();

function toMember({ member, role, email }: MemberRecord): Member {
  return {
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    email,
    phone: member.phone,
    role: { id: role.id, name: role.name, active: role.active },
    isCourier: member.isCourier,
    isOwner: member.isOwner,
    active: member.active,
    createdAt: member.createdAt.toISOString(),
  };
}

export interface MembersDependencies {
  members: MembersRepository;
  roles: RolesRepository;
  authAdmin: AuthAdmin;
  now?: () => Date;
  generateId?: () => string;
}

/**
 * People with access to a restaurant (owner only). Every method takes the restaurant of the signed-in
 * owner; an id from another restaurant is a 404. Inputs must already be validated with the shared schemas.
 */
export function createMembersService({
  members,
  roles,
  authAdmin,
  now = () => new Date(),
  generateId = () => crypto.randomUUID(),
}: MembersDependencies) {
  async function recordOf(restaurantId: string, id: string): Promise<MemberRecord> {
    const record = await members.find(restaurantId, id);
    if (!record) throw new MemberNotFoundError();
    return record;
  }

  /** A role that can be assigned: of this restaurant, active and not the system role. */
  async function assertAssignable(restaurantId: string, roleId: string): Promise<void> {
    const record = await roles.find(restaurantId, roleId);
    if (!record || record.role.isSystem || !record.role.active) {
      throw new ValidationError("roleId: elegí un rol activo de tu local");
    }
  }

  /** Never touches the owner's member (role, active flag, password, deletion). */
  function assertNotOwner(record: MemberRecord): void {
    if (record.member.isOwner) throw new OwnerImmutableError();
  }

  return {
    async list(restaurantId: string, query: MemberListQuery): Promise<MemberList> {
      const { records, total } = await members.list(restaurantId, query);
      return { members: records.map(toMember), page: query.page, limit: query.limit, total };
    },

    /**
     * Creates the account (verified email, password, no email sent) and then the member. The two
     * writes are not atomic (Better Auth writes on its own), so when the member insert fails the
     * account is deleted again instead of staying as a loose user that blocks the email.
     */
    async create(restaurantId: string, input: CreateMemberInput): Promise<Member> {
      await assertAssignable(restaurantId, input.roleId);

      let userId: string;
      try {
        ({ userId } = await authAdmin.createCredentialUser({
          name: fullName(input.firstName, input.lastName),
          email: input.email,
          password: input.password,
        }));
      } catch (error) {
        if (error instanceof EmailAlreadyRegisteredError) throw new EmailInUseError();
        throw error;
      }

      const at = now();
      try {
        const record = await members.insert({
          id: generateId(),
          restaurantId,
          userId,
          roleId: input.roleId,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          isOwner: false,
          isCourier: input.isCourier,
          active: true,
          createdAt: at,
          updatedAt: at,
        });
        return toMember(record);
      } catch (error) {
        await authAdmin.deleteUser(userId).catch((cleanupError: unknown) => {
          console.error("[members] could not delete the account after a failed member insert", cleanupError);
        });
        if (error instanceof UniqueViolationError) throw new EmailInUseError();
        throw error;
      }
    },

    /** The owner's name, phone and courier flag can change; its role cannot. */
    async update(restaurantId: string, id: string, input: UpdateMemberInput): Promise<Member> {
      const current = await recordOf(restaurantId, id);
      if (input.roleId !== undefined && input.roleId !== current.role.id) {
        assertNotOwner(current);
        await assertAssignable(restaurantId, input.roleId);
      }

      const updated = await members.update(restaurantId, id, input, now());
      if (!updated) throw new MemberNotFoundError();

      const nameChanged =
        updated.member.firstName !== current.member.firstName || updated.member.lastName !== current.member.lastName;
      if (nameChanged) {
        await authAdmin.renameUser(updated.member.userId, fullName(updated.member.firstName, updated.member.lastName));
      }
      return toMember(updated);
    },

    /** Deactivating also deletes the sessions, so access stops now; reactivating does not bring them back. */
    async setActive(restaurantId: string, id: string, active: boolean): Promise<Member> {
      const current = await recordOf(restaurantId, id);
      assertNotOwner(current);
      const updated = await members.update(restaurantId, id, { active }, now());
      if (!updated) throw new MemberNotFoundError();
      if (!active) await authAdmin.revokeSessions(updated.member.userId);
      return toMember(updated);
    },

    /** Sets a new password for the person and signs them out everywhere. */
    async setPassword(restaurantId: string, id: string, password: string): Promise<void> {
      const current = await recordOf(restaurantId, id);
      assertNotOwner(current);
      await authAdmin.setPassword(current.member.userId, password);
      await authAdmin.revokeSessions(current.member.userId);
    },

    /**
     * Deletes the account first: the member row, sessions and credentials all cascade from it, so a failure
     * leaves everything intact instead of an orphan login without a membership. The email can be used again.
     */
    async remove(restaurantId: string, id: string): Promise<void> {
      const current = await recordOf(restaurantId, id);
      assertNotOwner(current);
      await authAdmin.deleteUser(current.member.userId);
      // Safety net in case the cascade did not remove the row (it is a no-op when it did).
      await members.delete(restaurantId, id);
    },
  };
}

export type MembersService = ReturnType<typeof createMembersService>;

/** Wires the service with D1 and Better Auth's internal context (`env` is the Worker's bindings). */
export async function membersServiceFor(env: Env): Promise<MembersService> {
  return createMembersService({
    members: createMembersRepository(env.DB),
    roles: createRolesRepository(env.DB),
    authAdmin: await createAuthAdmin(env),
  });
}
