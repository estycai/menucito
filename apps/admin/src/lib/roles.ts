import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PermissionKey, Role } from "@menucito/shared";
import { api, useMyRestaurant } from "./restaurant";

export const ROLES_KEY = ["roles"] as const;

export interface RoleBody {
  name: string;
  permissions: PermissionKey[];
}

const jsonBody = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

/** Roles of the restaurant, the owner's system role first (owner only). */
export function useRoles() {
  const { data: restaurant } = useMyRestaurant();
  return useQuery({
    queryKey: ROLES_KEY,
    enabled: Boolean(restaurant?.access.isOwner),
    queryFn: () => api<Role[]>("/api/roles"),
  });
}

/** A role change can change what members see, and the user list shows each member's role. */
function useRoleMutation<TVariables, TResult>(mutationFn: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ROLES_KEY }),
        queryClient.invalidateQueries({ queryKey: ["members"] }),
      ]),
  });
}

export function useCreateRole() {
  return useRoleMutation((body: RoleBody) => api<Role>("/api/roles", jsonBody("POST", body)));
}

export function useUpdateRole() {
  return useRoleMutation(({ id, body }: { id: string; body: Partial<RoleBody> & { active?: boolean } }) =>
    api<Role>(`/api/roles/${id}`, jsonBody("PATCH", body)),
  );
}

export function useDeleteRole() {
  return useRoleMutation((id: string) => api<void>(`/api/roles/${id}`, { method: "DELETE" }));
}

/** Roles that can be given to a member: active ones, never the owner's system role. */
export const assignableRoles = (roles: readonly Role[] | undefined): Role[] =>
  (roles ?? []).filter((role) => role.active && !role.isSystem);

/** Why a role cannot be deleted, or `null` when it can. */
export function roleDeleteBlock(role: Pick<Role, "memberCount">): string | null {
  if (role.memberCount === 0) return null;
  const count = role.memberCount;
  return `Tiene ${count} ${count === 1 ? "usuario" : "usuarios"}. Asignales otro rol antes de eliminarlo.`;
}

/** Confirmation text for turning off a role with members; `null` when nobody is affected. */
export function roleDeactivateWarning(role: Pick<Role, "memberCount">): string | null {
  const count = role.memberCount;
  if (count === 0) return null;
  return count === 1 ? "1 usuario se queda sin acceso." : `${count} usuarios se quedan sin acceso.`;
}
