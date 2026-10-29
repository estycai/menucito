import { Navigate, Outlet } from "react-router";
import { useMyRestaurant } from "@/lib/restaurant";
import { useSession } from "@/lib/session";

function Loading() {
  return <div className="flex min-h-screen items-center justify-center text-muted">Cargando...</div>;
}

function LoadError() {
  return (
    <div role="alert" className="flex min-h-screen items-center justify-center px-8 text-center text-danger">
      No pudimos cargar tu local. Recargá la página para intentar de nuevo.
    </div>
  );
}

/** Redirects to /login when there is no session. */
export function RequireAuth() {
  const { data: session, isPending } = useSession();
  if (isPending) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Login/sign-up pages: logged-in users go straight to the app. */
export function GuestOnly() {
  const { data: session, isPending } = useSession();
  if (isPending) return <Loading />;
  if (session) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** App pages that need a restaurant: users without one go to /onboarding. Use inside `RequireAuth`. */
export function RequireRestaurant() {
  const { data: restaurant, isPending, isError } = useMyRestaurant();
  if (isPending) return <Loading />;
  if (isError) return <LoadError />;
  if (!restaurant) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/** Onboarding: users who already have a restaurant go to /. Use inside `RequireAuth`. */
export function RequireNoRestaurant() {
  const { data: restaurant, isPending, isError } = useMyRestaurant();
  if (isPending) return <Loading />;
  if (isError) return <LoadError />;
  if (restaurant) return <Navigate to="/" replace />;
  return <Outlet />;
}
