import { Link, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { resetPasswordSchema, type ResetPasswordInput } from "@menucito/shared";
import { AuthLayout, Notice, PageTitle } from "@/components/AuthLayout";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { AuthError, authClient, unwrap } from "@/lib/auth-client";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const linkError = params.get("error");

  if (linkError || !token) return <InvalidLink />;
  return <ResetForm token={token} />;
}

function InvalidLink() {
  return (
    <AuthLayout>
      <PageTitle>Enlace inválido</PageTitle>
      <Notice tone="error">El enlace para restablecer tu contraseña es inválido o venció.</Notice>
      <Button asChild>
        <Link to="/forgot-password">Pedir un enlace nuevo</Link>
      </Button>
    </AuthLayout>
  );
}

function ResetForm({ token }: { token: string }) {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  const reset = useMutation({
    mutationFn: async (values: ResetPasswordInput) =>
      unwrap(await authClient.resetPassword({ newPassword: values.password, token })),
    onSuccess: () => navigate("/login?reset=1", { replace: true }),
  });

  if (reset.error instanceof AuthError && reset.error.code === "INVALID_TOKEN") return <InvalidLink />;

  return (
    <AuthLayout>
      <PageTitle>Elegí una contraseña nueva</PageTitle>
      <form noValidate onSubmit={handleSubmit((values) => reset.mutate(values))} className="flex flex-col gap-5">
        <FormField
          label="Contraseña nueva"
          type="password"
          autoComplete="new-password"
          error={errors.password?.message}
          {...register("password")}
        />
        {reset.error && <Notice tone="error">{reset.error.message}</Notice>}
        <Button type="submit" disabled={reset.isPending}>
          Guardar contraseña
        </Button>
      </form>
    </AuthLayout>
  );
}
