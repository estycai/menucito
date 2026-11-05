import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MEMBER_PAGE_SIZE,
  type Member,
  type MemberList,
} from "@menucito/shared";
import { ROLES_KEY } from "./roles";
import { api, useMyRestaurant } from "./restaurant";

export const MEMBERS_KEY = ["members"] as const;

/** Body of `POST /api/members` as the form sends it (the API turns prefix + number into E.164). */
export interface CreateMemberBody {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  roleId: string;
  isCourier: boolean;
  phonePrefix: string;
  /** Blank means "no phone". */
  phone: string;
}

/** Body of `PATCH /api/members/:id`: the same without email and password. */
export type UpdateMemberBody = Omit<CreateMemberBody, "email" | "password" | "roleId"> & {
  /** Not sent for the owner: their role cannot change. */
  roleId?: string;
};

const jsonBody = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

/** One page of the people with access to the restaurant (owner only). */
export function useMembers(page: number) {
  const { data: restaurant } = useMyRestaurant();
  return useQuery({
    queryKey: [...MEMBERS_KEY, page],
    enabled: Boolean(restaurant?.access.isOwner),
    queryFn: () => api<MemberList>(`/api/members?page=${page}&limit=${MEMBER_PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
}

/** Members change the role counts too, so both lists are refreshed after every write. */
function useMemberMutation<TVariables, TResult>(mutationFn: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: MEMBERS_KEY }),
        queryClient.invalidateQueries({ queryKey: ROLES_KEY }),
      ]),
  });
}

export function useCreateMember() {
  return useMemberMutation((body: CreateMemberBody) => api<Member>("/api/members", jsonBody("POST", body)));
}

export function useUpdateMember() {
  return useMemberMutation(({ id, body }: { id: string; body: UpdateMemberBody }) =>
    api<Member>(`/api/members/${id}`, jsonBody("PATCH", body)),
  );
}

export function useSetMemberActive() {
  return useMemberMutation(({ id, active }: { id: string; active: boolean }) =>
    api<Member>(`/api/members/${id}/active`, jsonBody("PATCH", { active })),
  );
}

export function useSetMemberPassword() {
  return useMemberMutation(({ id, password }: { id: string; password: string }) =>
    api<void>(`/api/members/${id}/password`, jsonBody("PUT", { password })),
  );
}

export function useDeleteMember() {
  return useMemberMutation((id: string) => api<void>(`/api/members/${id}`, { method: "DELETE" }));
}

/** "Nombre Apellido" (the last name can be empty for owners created before this existed). */
export const memberFullName = (member: Pick<Member, "firstName" | "lastName">) =>
  `${member.firstName} ${member.lastName}`.trim();

/** The field named at the start of an API validation message (`email: ...`), and the rest of it. */
export function parseFieldMessage(message: string): { field: string | null; text: string } {
  const match = /^(\w+): (.+)$/.exec(message);
  return match ? { field: match[1] ?? null, text: match[2] ?? message } : { field: null, text: message };
}
