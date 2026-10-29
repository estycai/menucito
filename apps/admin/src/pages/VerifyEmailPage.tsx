import { Link, useSearchParams } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { AuthLayout, Notice, PageTitle } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { authClient, unwrap } from "@/lib/auth-client";

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const email = params.get("email");

  const resend = useMutation({
    mutationFn: async (to: string) => unwrap(await authClient.sendVerificationEmail({ email: to, callbackURL: "/" })),
  });

  return (
    <AuthLayout>
      <PageTitle>Revisá tu email</PageTitle>
      <p className="m-0 text-base leading-normal text-muted">
        {email ? (
          <>
            Te enviamos un enlace de verificación a <strong className="text-ink">{email}</strong>.
          </>
        ) : (
          "Te enviamos un enlace de verificación."
        )}{" "}
        Abrilo para activar tu cuenta.
      </p>

      {resend.isSuccess && <Notice>Te enviamos un nuevo email.</Notice>}
      {resend.error && <Notice tone="error">{resend.error.message}</Notice>}

      {email && (
        <Button type="button" variant="outline" disabled={resend.isPending} onClick={() => resend.mutate(email)}>
          Reenviar email
        </Button>
      )}

      <Link to="/login" className="text-center text-sm font-bold text-link">
        Volver a ingresar
      </Link>
    </AuthLayout>
  );
}
