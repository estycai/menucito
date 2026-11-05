import { useId } from "react";
import type { Role } from "@menucito/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { roleDeleteBlock } from "@/lib/roles";

export interface RolesTableProps {
  roles: readonly Role[];
  onEdit: (role: Role) => void;
  onDelete: (role: Role) => void;
  /** Turning a role with users off asks for confirmation first. */
  onToggleActive: (role: Role, active: boolean) => void;
  savingId?: string | null;
}

function ActiveSwitch({ role, props }: { role: Role; props: RolesTableProps }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Switch
        checked={role.active}
        disabled={role.isSystem || props.savingId === role.id}
        aria-label={`Activo: ${role.name}`}
        onCheckedChange={(checked) => props.onToggleActive(role, checked)}
      />
      <span className="text-sm text-muted">{role.active ? "Activo" : "Inactivo"}</span>
    </span>
  );
}

/** Edit and delete; the system role has none, and a role with users cannot be deleted (and says why). */
function RoleActions({ role, props }: { role: Role; props: RolesTableProps }) {
  const blockId = useId();
  if (role.isSystem) return null;
  const block = roleDeleteBlock(role);
  return (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <div className="flex gap-1">
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 px-3 text-sm"
          aria-label={`Editar ${role.name}`}
          onClick={() => props.onEdit(role)}
        >
          Editar
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 px-3 text-sm text-danger"
          aria-label={`Eliminar ${role.name}`}
          aria-describedby={block ? blockId : undefined}
          disabled={block !== null}
          onClick={() => props.onDelete(role)}
        >
          Eliminar
        </Button>
      </div>
      {block && (
        <p id={blockId} className="m-0 max-w-[260px] px-3 text-xs text-muted md:text-right">
          {block}
        </p>
      )}
    </div>
  );
}

const userCount = (role: Role) => `${role.memberCount}`;

/** Role list: a table from `md`, cards on phones. */
export function RolesTable(props: RolesTableProps) {
  const { roles } = props;
  return (
    <>
      <table className="hidden w-full border-collapse rounded-2xl border border-line bg-white text-left text-[15px] md:table">
        <caption className="sr-only">Roles del local</caption>
        <thead>
          <tr className="border-b border-line text-[13px] text-muted">
            <th scope="col" className="px-4 py-3 font-bold">Nombre</th>
            <th scope="col" className="px-4 py-3 font-bold">Usuarios</th>
            <th scope="col" className="px-4 py-3 font-bold">Activo</th>
            <th scope="col" className="px-4 py-3 text-right font-bold">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.id} className="border-b border-line-soft align-top last:border-b-0">
              <th scope="row" className="px-4 py-3.5 font-bold">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="break-words">{role.name}</span>
                  {role.isSystem && <Badge tone="info">Sistema</Badge>}
                </span>
              </th>
              <td className="px-4 py-3.5">{userCount(role)}</td>
              <td className="px-4 py-1.5">
                <ActiveSwitch role={role} props={props} />
              </td>
              <td className="px-2 py-1.5 text-right">
                <RoleActions role={role} props={props} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="m-0 flex list-none flex-col gap-3 p-0 md:hidden">
        {roles.map((role) => (
          <li key={role.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-[15px] break-words">{role.name}</b>
              {role.isSystem && <Badge tone="info">Sistema</Badge>}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">
                <span className="text-muted">Usuarios: </span>
                {userCount(role)}
              </span>
              <ActiveSwitch role={role} props={props} />
            </div>
            <RoleActions role={role} props={props} />
          </li>
        ))}
      </ul>
    </>
  );
}
