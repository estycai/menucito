import { useState, type FormEvent } from "react";
import { CUSTOMER_TAG_COLORS, CUSTOMER_TAG_NAME_MAX_LENGTH, type CustomerTag, type CustomerTagColor } from "@menucito/shared";
import { CustomerTagPill, TAG_COLOR_CLASSES, TAG_COLOR_LABELS } from "@/components/customers/CustomerTagPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TagPickerProps {
  tags: readonly CustomerTag[];
  selectedIds: readonly string[];
  canEdit: boolean;
  onToggle: (tagId: string) => void;
  onCreate?: (input: { name: string; color: CustomerTagColor }) => Promise<unknown>;
  creating?: boolean;
}

/** Tags of the customer, plus the "new tag" form when the member may edit. */
export function TagPicker({ tags, selectedIds, canEdit, onToggle, onCreate, creating = false }: TagPickerProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<CustomerTagColor>("orange");
  const [error, setError] = useState<string | null>(null);
  const selected = tags.filter((tag) => selectedIds.includes(tag.id));

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const clean = name.trim();
    if (!clean) {
      setError("Ingresá el nombre de la etiqueta");
      return;
    }
    try {
      await onCreate?.({ name: clean, color });
      setName("");
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "No pudimos crear la etiqueta.");
    }
  }

  if (!canEdit) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {selected.length === 0 ? <span className="text-sm text-muted">Sin etiquetas</span> : selected.map((tag) => <CustomerTagPill key={tag.id} tag={tag} />)}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && <span className="text-sm text-muted">Todavía no hay etiquetas.</span>}
        {tags.map((tag) => {
          const active = selectedIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(tag.id)}
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-bold transition focus-visible:outline-2 focus-visible:outline-primary ${
                active ? TAG_COLOR_CLASSES[tag.color] : "border-dashed border-line-strong bg-white text-muted hover:border-primary"
              }`}
            >
              {active ? "✓ " : "+ "}
              {tag.name}
            </button>
          );
        })}
      </div>

      <form onSubmit={(event) => void create(event)} className="flex flex-col gap-2 rounded-xl border border-line bg-bg/40 p-3">
        <span className="text-xs font-bold text-muted">Nueva etiqueta</span>
        <div className="flex gap-2">
          <Input
            aria-label="Nombre de la etiqueta"
            value={name}
            maxLength={CUSTOMER_TAG_NAME_MAX_LENGTH}
            placeholder="ej: VIP"
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={creating} className="shrink-0 px-4">
            Crear
          </Button>
        </div>
        <div role="group" aria-label="Color de la etiqueta" className="flex flex-wrap gap-1.5">
          {CUSTOMER_TAG_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={color === option}
              aria-label={TAG_COLOR_LABELS[option]}
              title={TAG_COLOR_LABELS[option]}
              onClick={() => setColor(option)}
              className={`size-7 cursor-pointer rounded-full border-2 ${TAG_COLOR_CLASSES[option]} ${
                color === option ? "ring-2 ring-primary ring-offset-1" : ""
              }`}
            />
          ))}
        </div>
        {error && <p className="m-0 text-xs text-danger">{error}</p>}
      </form>
    </div>
  );
}
