import { useId } from "react";
import { Link } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import {
  DEFAULT_PHONE_PREFIX,
  MEMBER_MESSAGES,
  MEMBER_NAME_MAX_LENGTH,
  memberPasswordSchema,
  normalizeMemberPhone,
  type Member,
  type Role,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { FormField } from "@/components/FormField";
import { Modal } from "@/components/Modal";
import { PasswordField } from "@/components/PasswordField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { memberFullName, parseFieldMessage, useCreateMember, useUpdateMember } from "@/lib/members";
import { PHONE_PREFIXES, splitPhone } from "@/lib/phone";
import { ApiError } from "@/lib/restaurant";
import { assignableRoles } from "@/lib/roles";
import { USERS_TABS, usersTabPath } from "@/lib/users-tabs";

const personName = (required: string) =>
  z.string().trim().min(1, required).max(MEMBER_NAME_MAX_LENGTH, MEMBER_MESSAGES.nameTooLong);

/** Same rules as `createMemberSchema` / `updateMemberSchema`, on the strings as typed in the form. */
function formSchema(mode: "create" | "edit") {
  return z
    .object({
      firstName: personName(MEMBER_MESSAGES.firstNameRequired),
      lastName: personName(MEMBER_MESSAGES.lastNameRequired),
      email: mode === "create" ? z.string().trim().min(1, MEMBER_MESSAGES.emailRequired).email(MEMBER_MESSAGES.emailInvalid) : z.string(),
      password: mode === "create" ? memberPasswordSchema : z.string(),
      roleId: z.string().min(1, MEMBER_MESSAGES.roleRequired),
      isCourier: z.boolean(),
      phonePrefix: z.string(),
      phone: z.string(),
    })
    .superRefine((value, ctx) => {
      if (value.phone.trim() === "") return;
      if (!/^\+\d{1,3}$/.test(value.phonePrefix.replace(/\s/g, ""))) {
        ctx.addIssue({ code: "custom", path: ["phonePrefix"], message: MEMBER_MESSAGES.phonePrefixInvalid });
      } else if (!normalizeMemberPhone(value.phonePrefix, value.phone)) {
        ctx.addIssue({ code: "custom", path: ["phone"], message: MEMBER_MESSAGES.phoneInvalid });
      }
    });
}

type FormValues = z.infer<ReturnType<typeof formSchema>>;
type FieldName = keyof FormValues;
const FIELDS: readonly string[] = ["firstName", "lastName", "email", "password", "roleId", "isCourier", "phonePrefix", "phone"];

const selectClass =
  "box-border h-12 w-full min-w-0 rounded-xl border border-line bg-white px-3 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-bg disabled:text-muted aria-[invalid=true]:border-danger";

interface MemberFormDialogProps {
  /** The member to edit; `null` creates one. */
  member: Member | null;
  roles: readonly Role[];
  onClose: () => void;
}

/** "Crear usuario" and "Editar usuario": the same form, without email and password when editing. */
export function MemberFormDialog({ member, roles, onClose }: MemberFormDialogProps) {
  const mode = member ? "edit" : "create";
  const isOwner = member?.isOwner ?? false;
  const create = useCreateMember();
  const update = useUpdateMember();
  const courierId = useId();
  const roleFieldId = useId();
  const prefixId = useId();
  const phoneId = useId();

  const options = assignableRoles(roles);
  // A member whose role was turned off keeps it in the list, marked, so the select does not show a blank.
  const currentRole = member?.role;
  const roleOptions =
    currentRole && !options.some((role) => role.id === currentRole.id)
      ? [{ id: currentRole.id, name: currentRole.active ? currentRole.name : `${currentRole.name} (inactivo)` }, ...options]
      : options;

  const phone = splitPhone(member?.phone);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema(mode)),
    defaultValues: {
      firstName: member?.firstName ?? "",
      lastName: member?.lastName ?? "",
      email: member?.email ?? "",
      password: "",
      roleId: member?.role.id ?? "",
      isCourier: member?.isCourier ?? false,
      phonePrefix: phone.prefix || DEFAULT_PHONE_PREFIX,
      phone: phone.number,
    },
  });

  async function onValid(values: FormValues) {
    const common = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      isCourier: values.isCourier,
      phonePrefix: values.phonePrefix.trim(),
      phone: values.phone.trim(),
    };
    try {
      if (member) {
        // The owner's role cannot change, so it is not sent.
        const body = isOwner ? common : { ...common, roleId: values.roleId };
        await update.mutateAsync({ id: member.id, body });
        toast.success(`Guardamos los cambios de ${memberFullName({ ...member, ...common })}.`);
      } else {
        await create.mutateAsync({
          ...common,
          email: values.email.trim().toLowerCase(),
          password: values.password,
          roleId: values.roleId,
        });
        toast.success(`Creamos el usuario ${memberFullName(common)}.`);
      }
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "EMAIL_IN_USE") {
        setError("email", { message: "Ya hay una cuenta con ese email." });
      } else if (cause instanceof ApiError && cause.code === "VALIDATION_ERROR") {
        const { field, text } = parseFieldMessage(cause.message);
        if (field && FIELDS.includes(field)) setError(field as FieldName, { message: text });
        else setError("root", { message: text });
      } else if (cause instanceof ApiError && cause.code === "MEMBER_NOT_FOUND") {
        setError("root", { message: "Este usuario ya no existe. Cerrá esta ventana y recargá la lista." });
      } else {
        setError("root", { message: "No pudimos guardar el usuario. Probá de nuevo." });
      }
    }
  }

  const noRoles = roleOptions.length === 0;

  return (
    <Modal title={member ? "Editar usuario" : "Crear usuario"} onClose={onClose}>
      <form noValidate onSubmit={handleSubmit(onValid)} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Nombre" autoComplete="off" autoFocus error={errors.firstName?.message} {...register("firstName")} />
          <FormField label="Apellido" autoComplete="off" error={errors.lastName?.message} {...register("lastName")} />
        </div>

        {member ? (
          // Not registered: a disabled field would drop out of the submitted values.
          <FormField label="Email" type="email" disabled defaultValue={member.email} hint="Solo la persona puede cambiar su email." />
        ) : (
          <FormField
            label="Email"
            type="email"
            autoComplete="off"
            inputMode="email"
            error={errors.email?.message}
            {...register("email")}
          />
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={phoneId}>Teléfono de contacto (opcional)</Label>
          <div className="flex gap-2">
            <div className="w-[9.5rem] shrink-0">
              <label htmlFor={prefixId} className="sr-only">
                Prefijo
              </label>
              <select
                id={prefixId}
                className={selectClass}
                aria-invalid={errors.phonePrefix ? true : undefined}
                {...register("phonePrefix")}
              >
                {PHONE_PREFIXES.map((option) => (
                  <option key={option.prefix} value={option.prefix}>
                    {option.prefix} {option.country}
                  </option>
                ))}
              </select>
            </div>
            <Input
              id={phoneId}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              className="min-w-0 flex-1"
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby={errors.phone || errors.phonePrefix ? `${phoneId}-error` : undefined}
              {...register("phone")}
            />
          </div>
          {(errors.phone?.message || errors.phonePrefix?.message) && (
            <p id={`${phoneId}-error`} className="m-0 text-[13px] text-danger">
              {errors.phone?.message ?? errors.phonePrefix?.message}
            </p>
          )}
        </div>

        {!member && (
          <PasswordField
            label="Contraseña"
            hint="Al menos 8 caracteres. Se la pasás vos a la persona."
            error={errors.password?.message}
            {...register("password")}
          />
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={roleFieldId}>Rol</Label>
          {isOwner ? (
            <>
              <select id={roleFieldId} disabled defaultValue={member?.role.id} className={selectClass}>
                <option value={member?.role.id}>{member?.role.name}</option>
              </select>
              <p className="m-0 text-xs text-muted">El rol del dueño no se puede cambiar.</p>
            </>
          ) : (
            <>
              <select
                id={roleFieldId}
                className={selectClass}
                aria-invalid={errors.roleId ? true : undefined}
                aria-describedby={noRoles ? `${roleFieldId}-help ${roleFieldId}-hint` : `${roleFieldId}-help`}
                {...register("roleId")}
              >
                <option value="">Elegí un rol</option>
                {roleOptions.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <p id={`${roleFieldId}-help`} className="m-0 text-xs text-muted">
                Define a qué secciones puede entrar. Si solo va a repartir y no usa el admin, elegí un rol sin permisos.
              </p>
              {noRoles && (
                <p id={`${roleFieldId}-hint`} className="m-0 text-xs text-muted">
                  Todavía no hay roles activos.{" "}
                  <Link to={usersTabPath(USERS_TABS[1]!)} onClick={onClose} className="font-bold text-link underline">
                    Creá uno en Roles y permisos
                  </Link>
                  .
                </p>
              )}
              {errors.roleId?.message && <p className="m-0 text-[13px] text-danger">{errors.roleId.message}</p>}
            </>
          )}
        </div>

        <div className="flex flex-col gap-0.5">
          <label htmlFor={courierId} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
            <input id={courierId} type="checkbox" className="m-0 size-5 accent-primary" aria-describedby={`${courierId}-hint`} {...register("isCourier")} />
            Es repartidor
          </label>
          <p id={`${courierId}-hint`} className="m-0 pl-8 text-xs text-muted">
            Aparece en la lista de repartidores al asignar un pedido.
          </p>
        </div>

        {errors.root?.message && <Notice tone="error">{errors.root.message}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose} className="px-5">
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting || (noRoles && !isOwner)} className="min-h-12 rounded-xl px-6 text-[15px]">
            {isSubmitting ? "Guardando…" : member ? "Guardar cambios" : "Crear usuario"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
