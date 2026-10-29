import { Link, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RestaurantAvatar } from "@/components/RestaurantAvatar";
import { Button } from "@/components/ui/button";
import { authClient, unwrap } from "@/lib/auth-client";
import { RESTAURANT_KEY, publicMenuUrl, useMyRestaurant } from "@/lib/restaurant";
import { SESSION_KEY, useSession } from "@/lib/session";

const WHATSAPP_TEST_MESSAGE = "Hola! Este es un mensaje de prueba de Menucito.";

/** `5491112345678` -> `+54 9 1112345678`; the area code length varies, so it is not split further. */
function formatWhatsapp(digits: string) {
  return `+${digits.slice(0, 2)} ${digits.slice(2, 3)} ${digits.slice(3)}`;
}

function whatsappTestUrl(digits: string) {
  return `https://wa.me/${digits}?text=${encodeURIComponent(WHATSAPP_TEST_MESSAGE)}`;
}

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
          <div className="mb-2 flex items-center gap-4 text-left">
            <RestaurantAvatar name={restaurant.name} logoUrl={restaurant.logoUrl} />
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="m-0 font-display text-2xl font-extrabold break-words">{restaurant.name}</h2>
              <div className="flex flex-wrap gap-x-4">
                <Link to="/menu" className="inline-flex min-h-11 min-w-11 items-center text-sm font-bold text-link underline-offset-2 hover:underline">
                  Mi menú
                </Link>
                <Link to="/local" className="inline-flex min-h-11 min-w-11 items-center text-sm font-bold text-link underline-offset-2 hover:underline">
                  Mi local
                </Link>
              </div>
            </div>
          </div>
          <p className="m-0 text-sm text-muted">Tu link</p>
          <p className="m-0 rounded-xl bg-addon px-3 py-2 text-[15px] font-bold break-all text-link">
            {publicMenuUrl(restaurant.slug)}
          </p>
          <p className="m-0 mt-2 text-sm text-muted">Tu WhatsApp</p>
          <p className="m-0 text-[15px] font-bold">{formatWhatsapp(restaurant.whatsapp)}</p>
          <a
            href={whatsappTestUrl(restaurant.whatsapp)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center text-sm font-bold text-link underline-offset-2 hover:underline"
          >
            Enviar mensaje de prueba
          </a>
        </div>
      )}
      <Button type="button" variant="outline" className="px-6" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
        Cerrar sesión
      </Button>
    </div>
  );
}
