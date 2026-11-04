import { MAX_DELIVERY_ZONES, type LatLng } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { ReorderButtons } from "@/components/ReorderButtons";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { zonePriceLabel, type ZoneDraft, type ZoneErrors } from "@/lib/zone-form";
import { cn } from "@/lib/utils";
import { ZoneForm } from "./ZoneForm";

export type SaveStatus = { tone: "success" | "error"; text: string } | null;

/** "Zonas de entrega": the zone rows (in priority order), the open zone's form and the save button. */
export function ZoneListCard({
  drafts,
  errors,
  center,
  expandedKey,
  hiddenKeys,
  drawingKey,
  dirty,
  saving,
  status,
  onChange,
  onExpand,
  onToggleHidden,
  onToggleDrawing,
  onMove,
  onDelete,
  onAdd,
  onSave,
}: {
  drafts: readonly ZoneDraft[];
  errors: Record<string, ZoneErrors>;
  center: LatLng | null;
  expandedKey: string | null;
  hiddenKeys: ReadonlySet<string>;
  drawingKey: string | null;
  dirty: boolean;
  saving: boolean;
  status: SaveStatus;
  onChange: (key: string, patch: Partial<ZoneDraft>) => void;
  onExpand: (key: string | null) => void;
  onToggleHidden: (key: string) => void;
  onToggleDrawing: (key: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onDelete: (key: string) => void;
  onAdd: () => void;
  onSave: () => void;
}) {
  return (
    <SectionCard
      title="Zonas de entrega"
      description="Si una dirección cae en más de una zona, se usa la primera de la lista que esté activa."
    >
      {drafts.length === 0 ? (
        <p className="m-0 text-sm text-muted">Todavía no tenés zonas. Creá la primera para empezar a cobrar por zona.</p>
      ) : (
        <ul aria-label="Zonas" className="m-0 flex list-none flex-col gap-2 p-0">
          {drafts.map((draft, index) => {
            const expanded = draft.key === expandedKey;
            const hidden = hiddenKeys.has(draft.key);
            const invalid = Boolean(errors[draft.key]);
            const name = draft.name.trim() || "Zona sin nombre";
            return (
              <li key={draft.key} className={cn("flex flex-col gap-2 rounded-xl border p-2", invalid ? "border-danger" : "border-line")}>
                <div className="flex items-center gap-1">
                  <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center" title="Activa">
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={(e) => onChange(draft.key, { active: e.target.checked })}
                      aria-label={`Activa: ${name}`}
                      className="size-5 cursor-pointer rounded border-line accent-primary"
                    />
                  </label>
                  <button
                    type="button"
                    // Keeps the visible text in the name (label-in-name) and says what the button does.
                    aria-label={`${expanded ? "Cerrar" : "Editar"} ${name} - ${zonePriceLabel(draft)}`}
                    aria-expanded={expanded}
                    onClick={() => onExpand(expanded ? null : draft.key)}
                    className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[10px] px-2 text-left hover:bg-bg focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span aria-hidden="true" className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: draft.color }} />
                    <span className={cn("min-w-0 truncate text-sm font-semibold", !draft.active && "text-muted")}>
                      {name} - {zonePriceLabel(draft)}
                    </span>
                  </button>
                  <IconButton label={hidden ? `Mostrar ${name} en el mapa` : `Ocultar ${name} en el mapa`} onClick={() => onToggleHidden(draft.key)}>
                    {hidden ? <EyeOffIcon /> : <EyeIcon />}
                  </IconButton>
                  <ReorderButtons name={name} isFirst={index === 0} isLast={index === drafts.length - 1} onMove={(direction) => onMove(index, direction)} />
                  <IconButton label={`Borrar ${name}`} onClick={() => onDelete(draft.key)}>
                    <TrashIcon />
                  </IconButton>
                </div>
                {expanded && (
                  <ZoneForm
                    draft={draft}
                    errors={errors[draft.key]}
                    center={center}
                    drawing={drawingKey === draft.key}
                    onChange={(patch) => onChange(draft.key, patch)}
                    onToggleDrawing={() => onToggleDrawing(draft.key)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Button type="button" variant="outline" className="self-start px-5" onClick={onAdd} disabled={drafts.length >= MAX_DELIVERY_ZONES}>
        + Nueva zona
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="min-w-0" aria-live="polite">
          {status?.tone === "success" && <Notice tone="success">{status.text}</Notice>}
        </div>
        <Button type="button" className="min-h-12 rounded-xl px-[26px] text-[15px]" disabled={!dirty || saving} onClick={onSave}>
          Guardar cambios
        </Button>
      </div>
      {status?.tone === "error" && <Notice tone="error">{status.text}</Notice>}
    </SectionCard>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label.split(" ")[0]}
      onClick={onClick}
      className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-ink hover:bg-tab focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

const EyeIcon = () => (
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </>
);

const EyeOffIcon = () => (
  <>
    <path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.2 3.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </>
);

const TrashIcon = () => (
  <>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </>
);
