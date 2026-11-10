import { useId, useState } from "react";
import {
  PERMISSION_SECTIONS,
  REPORT_FILTER_PERMISSIONS,
  REPORT_GENERAL_PERMISSIONS,
  REPORT_TABS,
  type PermissionDefinition,
  type PermissionKey,
  type PermissionSection,
} from "@menucito/shared";
import { Link } from "react-router";
import { sectionState, togglePermission } from "@/lib/permission-tree";
import { cn } from "@/lib/utils";

interface PermissionTreeProps {
  value: readonly PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  disabled?: boolean;
  /** Names the group for screen readers. */
  label?: string;
  /** Shows the link to the Reports preview when the role being edited already exists. */
  roleId?: string;
}

const checkboxClass = "m-0 size-5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed";

/**
 * Sections of the permission catalog, each with a checkbox and, when it has sub-permissions, a button
 * that unfolds them. Reports shows its three levels: general, filters and tabs with their blocks.
 */
export function PermissionTree({ value, onChange, disabled = false, label = "Permisos", roleId }: PermissionTreeProps) {
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-xl border border-line p-0">
      {PERMISSION_SECTIONS.map((section) => (
        <SectionRow
          key={section.key}
          section={section}
          value={value}
          onChange={onChange}
          disabled={disabled}
          roleId={roleId}
        />
      ))}
    </ul>
  );
}

function CheckRow({
  entry,
  value,
  onChange,
  disabled,
  small = false,
}: {
  entry: PermissionDefinition;
  value: readonly PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  disabled: boolean;
  small?: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-11 items-center gap-3 pr-3",
        small ? "text-sm" : "text-[15px] font-bold",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <input
        id={id}
        type="checkbox"
        className={checkboxClass}
        checked={value.includes(entry.key as PermissionKey)}
        disabled={disabled}
        onChange={() => onChange(togglePermission(value, entry.key as PermissionKey))}
      />
      <span className="min-w-0 break-words">{entry.label}</span>
    </label>
  );
}

function GroupLabel({ children }: { children: string }) {
  return <p className="m-0 pt-3 pb-1 pl-4 text-xs font-bold tracking-wide text-muted uppercase">{children}</p>;
}

/** The Reports tree: general keys, filters and the tabs with their blocks (disabled while the tab is off). */
function ReportsTree({
  value,
  onChange,
  disabled,
  roleId,
}: {
  value: readonly PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  disabled: boolean;
  roleId?: string;
}) {
  return (
    <div className="flex flex-col border-t border-line-soft bg-addon pb-2">
      {roleId && (
        <div className="px-4 pt-3">
          <Link to={`/reportes/configurar?rol=${roleId}`} className="text-sm font-bold text-link underline-offset-2 hover:underline">
            Configurar con vista previa en Reportes
          </Link>
        </div>
      )}
      <GroupLabel>Generales</GroupLabel>
      <div className="pl-11">
        {REPORT_GENERAL_PERMISSIONS.map((entry) => (
          <CheckRow key={entry.key} entry={entry} value={value} onChange={onChange} disabled={disabled} small />
        ))}
      </div>
      <GroupLabel>Filtros</GroupLabel>
      <div className="pl-11">
        {REPORT_FILTER_PERMISSIONS.map((entry) => (
          <CheckRow key={entry.key} entry={entry} value={value} onChange={onChange} disabled={disabled} small />
        ))}
      </div>
      <GroupLabel>Pestañas y bloques</GroupLabel>
      <div className="flex flex-col gap-2 px-3">
        {REPORT_TABS.map((tab) => {
          const tabChecked = value.includes(tab.key);
          return (
            <TabRow
              key={tab.key}
              tab={tab}
              value={value}
              onChange={onChange}
              disabled={disabled}
              tabChecked={tabChecked}
            />
          );
        })}
      </div>
    </div>
  );
}

function TabRow({
  tab,
  value,
  onChange,
  disabled,
  tabChecked,
}: {
  tab: (typeof REPORT_TABS)[number];
  value: readonly PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  disabled: boolean;
  tabChecked: boolean;
}) {
  const [open, setOpen] = useState(tabChecked);
  const panelId = useId();
  const checkedCount = tab.widgets.filter((widget) => value.includes(widget.key as PermissionKey)).length;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex items-center gap-1 pr-1 pl-3">
        <label
          className={cn("flex min-h-11 min-w-0 flex-1 items-center gap-3 text-sm font-bold", disabled ? "cursor-not-allowed" : "cursor-pointer")}
        >
          <input
            type="checkbox"
            className={checkboxClass}
            checked={tabChecked}
            disabled={disabled}
            onChange={() => onChange(togglePermission(value, tab.key as PermissionKey))}
          />
          <span className="min-w-0 break-words">{tab.label}</span>
          {checkedCount > 0 && <span className="shrink-0 rounded-md bg-bg px-2 py-0.5 text-xs font-bold text-muted">{checkedCount} de {tab.widgets.length}</span>}
        </label>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? "Ocultar" : "Mostrar"} los bloques de ${tab.label}`}
          onClick={() => setOpen((current) => !current)}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={cn("size-5 transition-transform motion-reduce:transition-none", open && "rotate-180")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      <div id={panelId} className={cn("border-t border-line-soft bg-addon pl-8", open ? "block" : "hidden")}>
        {tab.widgets.map((widget) => (
          <CheckRow
            key={widget.key}
            entry={widget}
            value={value}
            onChange={onChange}
            disabled={disabled || !tabChecked}
            small
          />
        ))}
      </div>
    </div>
  );
}

function SectionRow({
  section,
  value,
  onChange,
  disabled,
  roleId,
}: {
  section: PermissionSection;
  value: readonly PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  disabled: boolean;
  roleId?: string;
}) {
  const state = sectionState(value, section);
  const hasSubpermissions = section.subpermissions.length > 0;
  // Sections that already have sub-permissions checked start unfolded, so an edit shows what the role has.
  // Reportes also opens when only `stats.view` is checked, so its general keys and tabs are reachable.
  const [open, setOpen] = useState(state.checkedCount > 0 || (section.key === "stats.view" && state.checked));
  const panelId = useId();
  const sectionId = useId();

  return (
    <li className="flex flex-col bg-white">
      <div className="flex items-center gap-1 pr-1 pl-3">
        <label
          htmlFor={sectionId}
          className={cn("flex min-h-11 min-w-0 flex-1 items-center gap-3 text-[15px] font-bold", disabled ? "cursor-not-allowed" : "cursor-pointer")}
        >
          <input
            id={sectionId}
            type="checkbox"
            className={checkboxClass}
            checked={state.checked}
            disabled={disabled}
            onChange={() => onChange(togglePermission(value, section.key as PermissionKey))}
          />
          <span className="min-w-0 break-words">{section.label}</span>
          {state.summary && <span className="shrink-0 rounded-md bg-bg px-2 py-0.5 text-xs font-bold text-muted">{state.summary}</span>}
        </label>
        {hasSubpermissions && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? "Ocultar" : "Mostrar"} los permisos de ${section.label}`}
            onClick={() => setOpen((current) => !current)}
            className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className={cn("size-5 transition-transform motion-reduce:transition-none", open && "rotate-180")}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        )}
      </div>

      {hasSubpermissions && (
        <div id={panelId} className={open ? "block" : "hidden"}>
          {section.key === "stats.view" ? (
            <ReportsTree value={value} onChange={onChange} disabled={disabled} roleId={roleId} />
          ) : (
            <ul className="m-0 list-none border-t border-line-soft bg-addon p-0 py-1 pl-11">
              {section.subpermissions.map((sub) => (
                <li key={sub.key}>
                  <CheckRow entry={sub} value={value} onChange={onChange} disabled={disabled} small />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
