import { useId, useState } from "react";
import { PERMISSION_SECTIONS, type PermissionKey, type PermissionSection } from "@menucito/shared";
import { sectionState, togglePermission } from "@/lib/permission-tree";
import { cn } from "@/lib/utils";

interface PermissionTreeProps {
  value: readonly PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  disabled?: boolean;
  /** Names the group for screen readers. */
  label?: string;
}

const checkboxClass = "m-0 size-5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed";

/**
 * Sections of the permission catalog, each with a checkbox and, when it has sub-permissions, a button
 * that unfolds them. The checking rules live in `togglePermission`. Everything works with the keyboard
 * and every checkbox has its label.
 */
export function PermissionTree({ value, onChange, disabled = false, label = "Permisos" }: PermissionTreeProps) {
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-xl border border-line p-0">
      {PERMISSION_SECTIONS.map((section) => (
        <SectionRow key={section.key} section={section} value={value} onChange={onChange} disabled={disabled} />
      ))}
    </ul>
  );
}

function SectionRow({
  section,
  value,
  onChange,
  disabled,
}: {
  section: PermissionSection;
  value: readonly PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  disabled: boolean;
}) {
  const state = sectionState(value, section);
  const hasSubpermissions = section.subpermissions.length > 0;
  // Sections that already have sub-permissions checked start unfolded, so an edit shows what the role has.
  const [open, setOpen] = useState(state.checkedCount > 0);
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
        <ul id={panelId} className={cn("m-0 list-none border-t border-line-soft bg-addon p-0 py-1 pl-11", open ? "flex flex-col" : "hidden")}>
          {section.subpermissions.map((sub) => {
            const subId = `${sectionId}-${sub.key}`;
            return (
              <li key={sub.key}>
                <label
                  htmlFor={subId}
                  className={cn("flex min-h-11 items-center gap-3 pr-3 text-sm", disabled ? "cursor-not-allowed" : "cursor-pointer")}
                >
                  <input
                    id={subId}
                    type="checkbox"
                    className={checkboxClass}
                    checked={value.includes(sub.key as PermissionKey)}
                    disabled={disabled}
                    onChange={() => onChange(togglePermission(value, sub.key as PermissionKey))}
                  />
                  <span className="min-w-0 break-words">{sub.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
