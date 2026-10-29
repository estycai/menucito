import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { authClient, unwrap } from "@/lib/auth-client";
import { RESTAURANT_KEY, publicMenuUrl, useMyRestaurant } from "@/lib/restaurant";
import { SESSION_KEY, useSession } from "@/lib/session";

export function WelcomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { data: restaurant } = useMyRestaurant();

  const signOut = useMutation({
    mutationFn: async () => unwrap(await authClient.signOut()),
    onSuccess: () => {
      queryClient.setQueryData(SESSION_KEY, null);
      queryClient.removeQueries({ queryKey: RESTAURANT_KEY });
      navigate("/login", { replace: true });
    },
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-8 text-center">
      <span className="font-display text-[26px] font-extrabold">
        menucito<span className="text-accent">.</span>
      </span>
      <h1 className="m-0 font-display text-[40px] font-extrabold">Bienvenido {session?.user.name}</h1>
      {restaurant && (
        <div className="flex w-full max-w-[420px] flex-col gap-2 rounded-[20px] border border-line bg-white p-6">
          <h2 className="m-0 font-display text-2xl font-extrabold">{restaurant.name}</h2>
          <p className="m-0 text-sm text-muted">Tu link</p>
          <p className="m-0 rounded-xl bg-addon px-3 py-2 text-[15px] font-bold break-all text-link">
            {publicMenuUrl(restaurant.slug)}
          </p>
        </div>
      )}
      <Button type="button" variant="outline" className="px-6" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
        Cerrar sesión
      </Button>
    </div>
  );
}
