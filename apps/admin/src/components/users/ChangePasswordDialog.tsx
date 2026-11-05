import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { setMemberPasswordSchema, type Member, type SetMemberPasswordInput } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { Modal } from "@/components/Modal";
import { PasswordField } from "@/components/PasswordField";
import { Button } from "@/components/ui/button";
import { memberFullName, parseFieldMessage, useSetMemberPassword } from "@/lib/members";
import { ApiError } from "@/lib/restaurant";

/** The owner sets a new password for a member; the member is signed out everywhere (decision 10). */
export function ChangePasswordDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const name = memberFullName(member);
  const setPassword = useSetMemberPassword();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SetMemberPasswordInput>({ resolver: zodResolver(setMemberPasswordSchema), defaultValues: { password: "" } });

  async function onValid(values: SetMemberPasswordInput) {
    try {
      await setPassword.mutateAsync({ id: member.id, password: values.password });
      toast.success(`Cambiamos la contraseña de ${name}.`);
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "VALIDATION_ERROR") {
        setError("password", { message: parseFieldMessage(cause.message).text });
      } else {
        setError("root", { message: "No pudimos cambiar la contraseña. Probá de nuevo." });
      }
    }
  }

  return (
    <Modal title="Cambiar contraseña" size="sm" onClose={onClose}>
      <form noValidate onSubmit={handleSubmit(onValid)} className="flex flex-col gap-4">
        <PasswordField
          label="Contraseña nueva"
          autoFocus
          hint="Al menos 8 caracteres."
          error={errors.password?.message}
          {...register("password")}
        />
        <Notice tone="warning">Se va a cerrar la sesión de {name} en todos sus dispositivos.</Notice>
        {errors.root?.message && <Notice tone="error">{errors.root.message}</Notice>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose} className="px-5">
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting} className="min-h-12 rounded-xl px-5 text-[15px]">
            {isSubmitting ? "Guardando…" : "Cambiar contraseña"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
