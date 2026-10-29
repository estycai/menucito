import { Link } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@menucito/shared";
import { AuthLayout, Notice, PageTitle } from "@/components/AuthLayout";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { authClient, unwrap } from "@/lib/auth-client";

export function ForgotPasswordPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  const forgot = useMutation({
    mutationFn: async (values: ForgotPasswordInput) =>
      unwrap(await authClient.requestPasswordReset({ email: values.email, redirectTo: "/reset-password" })),
  });

  return (
    <AuthLayout>
      <PageTitle>Recuperá tu contraseña</PageTitle>
      <p className="m-0 text-base leading-normal text-muted">
        Ingresá tu email y te enviamos un enlace para elegir una contraseña nueva.
      </p>

      {forgot.isSuccess ? (
        <Notice>Si existe una cuenta con ese email, te enviamos un email con instrucciones.</Notice>
      ) : (
        <form noValidate onSubmit={handleSubmit((values) => forgot.mutate(values))} className="flex flex-col gap-5">
          <FormField label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
          {forgot.error && <Notice tone="error">{forgot.error.message}</Notice>}
          <Button type="submit" disabled={forgot.isPending}>
            Enviar enlace
          </Button>
        </form>
      )}

      <Link to="/login" className="inline-flex min-h-11 items-center justify-center text-sm font-bold text-link">
        Volver a ingresar
      </Link>
    </AuthLayout>
  );
}
