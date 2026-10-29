import { useId, useState, type FormEvent } from "react";
import { CATALOG_MESSAGES, categoryNameSchema } from "@menucito/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/restaurant";

/** Inline form to create or rename a category: same rules as the API (trimmed, 1-40, unique). */
export function CategoryNameForm({
  label,
  initialName = "",
  submitLabel,
  onSubmit,
  onCancel,
}: {
  label: string;
  initialName?: string;
  submitLabel: string;
  /** Resolves when saved; an `ApiError` with `CATEGORY_NAME_TAKEN` shows the field error. */
  onSubmit: (name: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = categoryNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? CATALOG_MESSAGES.categoryNameRequired);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit(parsed.data);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === "CATEGORY_NAME_TAKEN"
          ? CATALOG_MESSAGES.categoryNameTaken
          : "No pudimos guardar la categoría. Probá de nuevo.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex w-full min-w-0 flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Input
        id={id}
        value={name}
        autoFocus
        maxLength={60}
        placeholder={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="min-h-11 flex-1 rounded-[10px] text-sm" disabled={saving}>
          {submitLabel}
        </Button>
        <Button type="button" variant="outline" className="min-h-11 flex-1 rounded-[10px] text-sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
