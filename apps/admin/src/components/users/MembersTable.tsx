import type { Member } from "@menucito/shared";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ActionsMenu, type ActionsMenuItem } from "@/components/users/ActionsMenu";
import { memberFullName } from "@/lib/members";

export interface MembersTableProps {
  members: readonly Member[];
  onEdit: (member: Member) => void;
  onChangePassword: (member: Member) => void;
  /** Asks for confirmation before turning a member off; turning one on needs none. */
  onToggleActive: (member: Member, active: boolean) => void;
  onDelete: (member: Member) => void;
  /** Id of the member whose switch is being saved. */
  savingId?: string | null;
}

const roleText = (member: Member) => (member.role.active ? member.role.name : `${member.role.name} (inactivo)`);

function menuItems(member: Member, props: MembersTableProps): ActionsMenuItem[] {
  const items: ActionsMenuItem[] = [{ label: "Editar", onSelect: () => props.onEdit(member) }];
  // The owner cannot change password, be turned off or deleted from here.
  if (!member.isOwner) {
    items.push(
      { label: "Cambiar contraseña", onSelect: () => props.onChangePassword(member) },
      { label: "Eliminar", onSelect: () => props.onDelete(member), danger: true },
    );
  }
  return items;
}

function MemberBadges({ member }: { member: Member }) {
  if (!member.isOwner && !member.isCourier) return null;
  return (
    <>
      {member.isOwner && <Badge tone="info">Dueño</Badge>}
      {member.isCourier && <Badge tone="neutral">Repartidor</Badge>}
    </>
  );
}

function ActiveSwitch({ member, props }: { member: Member; props: MembersTableProps }) {
  const name = memberFullName(member);
  return (
    <span className="inline-flex items-center gap-1">
      <Switch
        checked={member.active}
        disabled={member.isOwner || props.savingId === member.id}
        aria-label={`Activo: ${name}`}
        onCheckedChange={(checked) => props.onToggleActive(member, checked)}
      />
      <span className="text-sm text-muted">{member.active ? "Activo" : "Inactivo"}</span>
    </span>
  );
}

/** User list: a table from `md`, cards on phones. The state of each user is text as well as color. */
export function MembersTable(props: MembersTableProps) {
  const { members } = props;
  return (
    <>
      <table className="hidden w-full border-collapse overflow-visible rounded-2xl border border-line bg-white text-left text-[15px] md:table">
        <caption className="sr-only">Usuarios del local</caption>
        <thead>
          <tr className="border-b border-line text-[13px] text-muted">
            <th scope="col" className="px-4 py-3 font-bold">Nombre</th>
            <th scope="col" className="px-4 py-3 font-bold">Email</th>
            <th scope="col" className="px-4 py-3 font-bold">Rol</th>
            <th scope="col" className="px-4 py-3 font-bold">Activo</th>
            <th scope="col" className="w-16 px-2 py-3 text-right font-bold">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id} className="border-b border-line-soft last:border-b-0">
              <th scope="row" className="px-4 py-2 font-bold">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="break-words">{memberFullName(member)}</span>
                  <MemberBadges member={member} />
                </span>
              </th>
              <td className="px-4 py-2 break-all">{member.email}</td>
              <td className="px-4 py-2">{roleText(member)}</td>
              <td className="px-4 py-1">
                <ActiveSwitch member={member} props={props} />
              </td>
              <td className="px-2 py-1 text-right">
                <ActionsMenu label={`Acciones de ${memberFullName(member)}`} items={menuItems(member, props)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="m-0 flex list-none flex-col gap-3 p-0 md:hidden">
        {members.map((member) => (
          <li key={member.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-1">
                <b className="text-[15px] break-words">{memberFullName(member)}</b>
                <div className="flex flex-wrap items-center gap-1.5">
                  <MemberBadges member={member} />
                </div>
              </div>
              <ActionsMenu label={`Acciones de ${memberFullName(member)}`} items={menuItems(member, props)} />
            </div>
            <span className="text-sm break-all text-muted">{member.email}</span>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">
                <span className="text-muted">Rol: </span>
                {roleText(member)}
              </span>
              <ActiveSwitch member={member} props={props} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
