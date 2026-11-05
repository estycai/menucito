import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { ROLE_NAME_MAX_LENGTH, roleSchema, type PermissionKey, type Role } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { FormField } from "@/components/FormField";
import { Modal } from "@/components/Modal";
import { PermissionTree } from "@/components/users/PermissionTree";
import { Button } from "@/components/ui/button";
import { parseFieldMessage } from "@/lib/members";
import { ApiError } from "@/lib/restaurant";
import { useCreateRole, useUpdateRole } from "@/lib/roles";

/** The name follows `roleSchema` (1 to 40 characters, never "Dueño"); the permissions are the tree's. */
const nameFormSchema = z.object({ name: roleSchema.shape.name });
type NameValues = z.input<typeof nameFormSchema>;

/** "Crear rol" and "Editar rol": one form (not a step-by-step wizard) with the name and the permission list. */
export function RoleFormDialog({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const create = useCreateRole();
  const update = useUpdateRole();
  const [permissions, setPermissions] = useState<PermissionKey[]>(role?.permissions ?? []);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NameValues>({ resolver: zodResolver(nameFormSchema), defaultValues: { name: role?.name ?? "" } });

  async function onValid({ name }: NameValues) {
    const body = { name: name.trim(), permissions };
    try {
      if (role) await update.mutateAsync({ id: role.id, body });
      else await create.mutateAsync(body);
      toast.success(role ? `Guardamos el rol ${body.name}.` : `Creamos el rol ${body.name}.`);
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "ROLE_NAME_TAKEN") {
        setError("name", { message: "Ya hay un rol con ese nombre." });
      } else if (cause instanceof ApiError && cause.code === "VALIDATION_ERROR") {
        const { field, text } = parseFieldMessage(cause.message);
        if (field === "name") setError("name", { message: text });
        else setError("root", { message: text });
      } else if (cause instanceof ApiError && (cause.code === "SYSTEM_ROLE" || cause.code === "ROLE_NOT_FOUND")) {
        setError("root", { message: "Este rol ya no se puede editar. Cerrá esta ventana y recargá la lista." });
      } else {
        setError("root", { message: "No pudimos guardar el rol. Probá de nuevo." });
      }
    }
  }

  return (
    <Modal title={role ? "Editar rol" : "Crear rol"} onClose={onClose}>
      <form noValidate onSubmit={handleSubmit(onValid)} className="flex flex-col gap-4">
        <FormField
          label="Nombre del rol"
          autoComplete="off"
          autoFocus
          maxLength={ROLE_NAME_MAX_LENGTH}
          error={errors.name?.message}
          {...register("name")}
        />

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-bold">Permisos</span>
          <p className="m-0 text-xs text-muted">
            Marcá lo que puede ver esta persona. Dentro de cada sección podés elegir también qué puede cambiar.
          </p>
          <PermissionTree value={permissions} onChange={setPermissions} label="Permisos del rol" />
        </div>

        {errors.root?.message && <Notice tone="error">{errors.root.message}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose} className="px-5">
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting} className="min-h-12 rounded-xl px-6 text-[15px]">
            {isSubmitting ? "Guardando…" : role ? "Guardar cambios" : "Crear rol"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
