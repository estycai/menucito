import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { loginSchema, signUpSchema, type LoginInput, type SignUpInput } from "@menucito/shared";
import { AuthLayout, Notice, PageTitle } from "@/components/AuthLayout";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { AuthError, authClient, authErrorMessage, unwrap } from "@/lib/auth-client";
import { SESSION_KEY } from "@/lib/session";
import { cn } from "@/lib/utils";

type Tab = "login" | "signup";

export function LoginPage() {
  const [tab, setTab] = useState<Tab>("login");
  const [params] = useSearchParams();
  const resetDone = params.get("reset") === "1";

  return (
    <AuthLayout>
      <div role="tablist" className="flex rounded-[14px] bg-tab p-1">
        <TabButton active={tab === "login"} onClick={() => setTab("login")}>
          Ingresar
        </TabButton>
        <TabButton active={tab === "signup"} onClick={() => setTab("signup")}>
          Crear cuenta
        </TabButton>
      </div>

      <PageTitle>{tab === "login" ? "Hola de nuevo" : "Creá tu cuenta"}</PageTitle>

      {resetDone && tab === "login" && <Notice>Contraseña actualizada. Ingresá con la nueva.</Notice>}

      <GoogleButton />

      <div className="flex items-center gap-3 text-[13px] text-muted">
        <span className="h-px flex-1 bg-line" />o con tu email<span className="h-px flex-1 bg-line" />
      </div>

      {tab === "login" ? <LoginForm /> : <SignUpForm />}

      <p className="m-0 text-center text-sm text-muted">
        {tab === "login" ? (
          <>
            ¿Primera vez?{" "}
            <button type="button" onClick={() => setTab("signup")} className="inline-flex min-h-11 cursor-pointer items-center font-bold text-link">
              Creá tu cuenta
            </button>
          </>
        ) : (
          <>
            ¿Ya tenés cuenta?{" "}
            <button type="button" onClick={() => setTab("login")} className="inline-flex min-h-11 cursor-pointer items-center font-bold text-link">
              Ingresá
            </button>
          </>
        )}
      </p>
    </AuthLayout>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-[10px] text-[15px]",
        active ? "bg-white font-bold text-ink" : "text-muted",
      )}
    >
      {children}
    </button>
  );
}

function GoogleButton() {
  const [error, setError] = useState<string | null>(null);
  const google = useMutation({
    mutationFn: async () => unwrap(await authClient.signIn.social({ provider: "google", callbackURL: "/" })),
    onError: () => setError("No pudimos iniciar sesión con Google. Probá de nuevo."),
  });
  return (
    <>
      <Button type="button" variant="outline" disabled={google.isPending} onClick={() => google.mutate()}>
        Continuar con Google
      </Button>
      {error && <Notice tone="error">{error}</Notice>}
    </>
  );
}

function LoginForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const login = useMutation({
    mutationFn: async (values: LoginInput) => unwrap(await authClient.signIn.email(values)),
    onMutate: () => {
      setUnverifiedEmail(null);
      setResent(false);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      navigate("/", { replace: true });
    },
    onError: (error, values) => {
      if (error instanceof AuthError && error.code === "EMAIL_NOT_VERIFIED") setUnverifiedEmail(values.email);
    },
  });

  const resend = useMutation({
    mutationFn: async (email: string) => unwrap(await authClient.sendVerificationEmail({ email, callbackURL: "/" })),
    onSuccess: () => setResent(true),
  });

  return (
    <form noValidate onSubmit={handleSubmit((values) => login.mutate(values))} className="flex flex-col gap-5">
      <FormField label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
      <FormField
        label="Contraseña"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <Link to="/forgot-password" className="-mt-2 inline-flex min-h-11 items-center self-end text-sm font-bold text-link">
        Olvidé mi contraseña
      </Link>

      {login.error && <Notice tone="error">{login.error.message || authErrorMessage(null)}</Notice>}
      {unverifiedEmail && (
        <div className="flex flex-col items-start gap-2">
          {resent ? (
            <Notice>Te enviamos un nuevo email de verificación.</Notice>
          ) : (
            <button
              type="button"
              disabled={resend.isPending}
              onClick={() => resend.mutate(unverifiedEmail)}
              className="inline-flex min-h-11 cursor-pointer items-center text-sm font-bold text-link"
            >
              Reenviar email de verificación
            </button>
          )}
        </div>
      )}

      <Button type="submit" disabled={login.isPending}>
        Ingresar
      </Button>
    </form>
  );
}

function SignUpForm() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema) });

  const signUp = useMutation({
    mutationFn: async (values: SignUpInput) => unwrap(await authClient.signUp.email({ ...values, callbackURL: "/" })),
    onSuccess: (_data, values) => {
      navigate(`/verify-email?email=${encodeURIComponent(values.email)}`);
    },
  });

  return (
    <form noValidate onSubmit={handleSubmit((values) => signUp.mutate(values))} className="flex flex-col gap-5">
      <FormField label="Nombre" autoComplete="name" error={errors.name?.message} {...register("name")} />
      <FormField label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
      <FormField
        label="Contraseña"
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register("password")}
      />
      {signUp.error && <Notice tone="error">{signUp.error.message}</Notice>}
      <Button type="submit" disabled={signUp.isPending}>
        Crear cuenta
      </Button>
    </form>
  );
}
