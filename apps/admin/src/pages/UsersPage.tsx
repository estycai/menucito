import { useState, type ReactNode } from "react";
import { Outlet } from "react-router";
import { toast } from "sonner";
import { MEMBER_PAGE_SIZE, type Member, type Role } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageTabs } from "@/components/PageTabs";
import { QueryError } from "@/components/QueryError";
import { ChangePasswordDialog } from "@/components/users/ChangePasswordDialog";
import { MemberFormDialog } from "@/components/users/MemberFormDialog";
import { MembersTable } from "@/components/users/MembersTable";
import { RoleFormDialog } from "@/components/users/RoleFormDialog";
import { RolesTable } from "@/components/users/RolesTable";
import { Button } from "@/components/ui/button";
import { memberFullName, useDeleteMember, useMembers, useSetMemberActive } from "@/lib/members";
import { ApiError } from "@/lib/restaurant";
import { roleDeactivateWarning, useDeleteRole, useRoles, useUpdateRole } from "@/lib/roles";
import { USERS_TABS, usersTabPath } from "@/lib/users-tabs";

const TABS = USERS_TABS.map((tab) => ({ to: usersTabPath(tab), label: tab.label }));

/** "Usuarios" (owner only): the title and the tab header; each tab is a child route rendered in the outlet. */
export function UsersPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Usuarios</h1>
      <PageTabs label="Secciones de Usuarios" tabs={TABS} />
      <Outlet />
    </div>
  );
}

function TabHeader({ description, action }: { description: string; action: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="m-0 max-w-[560px] text-sm text-muted">{description}</p>
      {action}
    </div>
  );
}

type MemberConfirm = { kind: "deactivate" | "delete"; member: Member };

/** Tab "Usuarios": the people with access, with create, edit, password, on/off and delete. */
export function UsersMembersTab() {
  const [page, setPage] = useState(1);
  const members = useMembers(page);
  const roles = useRoles();
  const setActive = useSetMemberActive();
  const deleteMember = useDeleteMember();

  const [form, setForm] = useState<{ member: Member | null } | null>(null);
  const [passwordFor, setPasswordFor] = useState<Member | null>(null);
  const [confirm, setConfirm] = useState<MemberConfirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const list = members.data;
  const totalPages = list ? Math.max(1, Math.ceil(list.total / (list.limit || MEMBER_PAGE_SIZE))) : 1;

  async function changeActive(member: Member, active: boolean) {
    setActionError(null);
    try {
      await setActive.mutateAsync({ id: member.id, active });
      toast.success(active ? `${memberFullName(member)} ya puede entrar.` : `Desactivamos a ${memberFullName(member)}.`);
      setConfirm(null);
    } catch (cause) {
      const message = actionFailure(cause, active ? "activar" : "desactivar");
      if (confirm) setConfirmError(message);
      else setActionError(message);
    }
  }

  async function remove(member: Member) {
    try {
      await deleteMember.mutateAsync(member.id);
      toast.success(`Eliminamos a ${memberFullName(member)}.`);
      setConfirm(null);
      // The last user of the last page is gone: show the previous page instead of an empty one.
      if (list && list.members.length === 1 && page > 1) setPage(page - 1);
    } catch (cause) {
      setConfirmError(actionFailure(cause, "eliminar"));
    }
  }

  function askConfirm(next: MemberConfirm) {
    setConfirmError(null);
    setConfirm(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <TabHeader
        description="Las personas de tu equipo que entran al panel con su email y su contraseña."
        action={
          <Button
            type="button"
            disabled={!roles.data}
            onClick={() => setForm({ member: null })}
            className="min-h-12 rounded-xl px-[22px] text-[15px]"
          >
            Crear usuario
          </Button>
        }
      />

      {actionError && <Notice tone="error">{actionError}</Notice>}

      {members.isPending ? (
        <p className="m-0 text-muted">Cargando usuarios...</p>
      ) : members.isError && !list ? (
        <QueryError message="No pudimos cargar los usuarios." onRetry={() => void members.refetch()} retrying={members.isRefetching} />
      ) : list ? (
        <>
          {members.isError && (
            <QueryError compact message="No pudimos actualizar la lista." onRetry={() => void members.refetch()} retrying={members.isRefetching} />
          )}
          <MembersTable
            members={list.members}
            savingId={setActive.isPending ? setActive.variables?.id : null}
            onEdit={(member) => setForm({ member })}
            onChangePassword={setPasswordFor}
            onToggleActive={(member, active) => (active ? void changeActive(member, true) : askConfirm({ kind: "deactivate", member }))}
            onDelete={(member) => askConfirm({ kind: "delete", member })}
          />
          {totalPages > 1 && (
            <nav aria-label="Páginas de usuarios" className="flex items-center justify-between gap-3">
              <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} className="min-h-11 px-4 text-sm">
                Anterior
              </Button>
              <span className="text-sm text-muted">
                Página {list.page} de {totalPages}
              </span>
              <Button type="button" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="min-h-11 px-4 text-sm">
                Siguiente
              </Button>
            </nav>
          )}
        </>
      ) : null}

      {form && roles.data && <MemberFormDialog member={form.member} roles={roles.data} onClose={() => setForm(null)} />}
      {passwordFor && <ChangePasswordDialog member={passwordFor} onClose={() => setPasswordFor(null)} />}

      {confirm?.kind === "deactivate" && (
        <ConfirmDialog
          title={`Desactivar a ${memberFullName(confirm.member)}`}
          confirmLabel="Desactivar"
          pending={setActive.isPending}
          error={confirmError}
          onConfirm={() => void changeActive(confirm.member, false)}
          onCancel={() => setConfirm(null)}
        >
          {memberFullName(confirm.member)} no va a poder entrar hasta que lo actives de nuevo.
        </ConfirmDialog>
      )}
      {confirm?.kind === "delete" && (
        <ConfirmDialog
          title={`Eliminar a ${memberFullName(confirm.member)}`}
          confirmLabel="Eliminar"
          danger
          pending={deleteMember.isPending}
          error={confirmError}
          onConfirm={() => void remove(confirm.member)}
          onCancel={() => setConfirm(null)}
        >
          Se borra la cuenta de {memberFullName(confirm.member)}. No se puede deshacer.
        </ConfirmDialog>
      )}
    </div>
  );
}

type RoleConfirm = { kind: "deactivate" | "delete"; role: Role };

/** Tab "Roles y permisos": the roles of the restaurant and what each one can see and do. */
export function UsersRolesTab() {
  const roles = useRoles();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();

  const [form, setForm] = useState<{ role: Role | null } | null>(null);
  const [confirm, setConfirm] = useState<RoleConfirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function changeActive(role: Role, active: boolean) {
    setActionError(null);
    try {
      await updateRole.mutateAsync({ id: role.id, body: { active } });
      toast.success(active ? `Activamos el rol ${role.name}.` : `Desactivamos el rol ${role.name}.`);
      setConfirm(null);
    } catch (cause) {
      const message = actionFailure(cause, active ? "activar" : "desactivar");
      if (confirm) setConfirmError(message);
      else setActionError(message);
    }
  }

  async function remove(role: Role) {
    try {
      await deleteRole.mutateAsync(role.id);
      toast.success(`Eliminamos el rol ${role.name}.`);
      setConfirm(null);
    } catch (cause) {
      setConfirmError(
        cause instanceof ApiError && cause.code === "ROLE_IN_USE"
          ? "Este rol ya tiene usuarios. Asignales otro rol antes de eliminarlo."
          : actionFailure(cause, "eliminar"),
      );
    }
  }

  function askConfirm(next: RoleConfirm) {
    setConfirmError(null);
    setConfirm(next);
  }

  function toggle(role: Role, active: boolean) {
    // A role with users takes their access away when it is turned off: ask first (decision 8).
    if (!active && roleDeactivateWarning(role)) askConfirm({ kind: "deactivate", role });
    else void changeActive(role, active);
  }

  return (
    <div className="flex flex-col gap-4">
      <TabHeader
        description="Un rol decide qué ve y qué puede hacer cada persona. Armá los que necesites."
        action={
          <Button type="button" onClick={() => setForm({ role: null })} className="min-h-12 rounded-xl px-[22px] text-[15px]">
            Crear rol
          </Button>
        }
      />

      {actionError && <Notice tone="error">{actionError}</Notice>}

      {roles.isPending ? (
        <p className="m-0 text-muted">Cargando roles...</p>
      ) : roles.isError && !roles.data ? (
        <QueryError message="No pudimos cargar los roles." onRetry={() => void roles.refetch()} retrying={roles.isRefetching} />
      ) : roles.data ? (
        <RolesTable
          roles={roles.data}
          savingId={updateRole.isPending ? updateRole.variables?.id : null}
          onEdit={(role) => setForm({ role })}
          onDelete={(role) => askConfirm({ kind: "delete", role })}
          onToggleActive={toggle}
        />
      ) : null}

      {form && <RoleFormDialog role={form.role} onClose={() => setForm(null)} />}

      {confirm?.kind === "deactivate" && (
        <ConfirmDialog
          title={`Desactivar el rol ${confirm.role.name}`}
          confirmLabel="Desactivar"
          pending={updateRole.isPending}
          error={confirmError}
          onConfirm={() => void changeActive(confirm.role, false)}
          onCancel={() => setConfirm(null)}
        >
          {roleDeactivateWarning(confirm.role)}
        </ConfirmDialog>
      )}
      {confirm?.kind === "delete" && (
        <ConfirmDialog
          title={`Eliminar el rol ${confirm.role.name}`}
          confirmLabel="Eliminar"
          danger
          pending={deleteRole.isPending}
          error={confirmError}
          onConfirm={() => void remove(confirm.role)}
          onCancel={() => setConfirm(null)}
        >
          Se borra el rol {confirm.role.name}. No se puede deshacer.
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Copy of a failed owner action; the codes the API uses for "the thing changed under you" get their own. */
function actionFailure(cause: unknown, verb: string): string {
  if (cause instanceof ApiError) {
    if (cause.code === "MEMBER_NOT_FOUND" || cause.code === "ROLE_NOT_FOUND") {
      return "Ya no existe. Recargá la página para ver la lista actualizada.";
    }
    if (cause.code === "OWNER_IMMUTABLE") return "El dueño no se puede modificar.";
    if (cause.code === "SYSTEM_ROLE") return "El rol del dueño no se puede modificar.";
  }
  return `No pudimos ${verb}. Probá de nuevo.`;
}
