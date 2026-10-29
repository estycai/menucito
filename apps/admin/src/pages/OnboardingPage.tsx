import { useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { useNavigate } from "react-router";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  RESTAURANT_MESSAGES,
  createRestaurantSchema,
  slugSchema,
  slugify,
  type CreateRestaurantInput,
  type SlugUnavailableReason,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ApiError,
  PUBLIC_BASE,
  RESTAURANT_KEY,
  SLUG_AVAILABILITY_KEY,
  slugAvailabilityOptions,
  useCreateRestaurant,
  useSlugAvailability,
} from "@/lib/restaurant";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";

const SLUG_CHECK_DELAY_MS = 400;

const UNAVAILABLE_MESSAGES: Record<SlugUnavailableReason, string> = {
  invalid: RESTAURANT_MESSAGES.slugInvalid,
  reserved: RESTAURANT_MESSAGES.slugReserved,
  taken: RESTAURANT_MESSAGES.slugTaken,
};

type SlugStatus = { tone: "success" | "error" | "muted"; text: string } | null;

export function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createRestaurant = useCreateRestaurant();
  /** Once the user types in the slug field we stop suggesting it from the name. */
  const [slugEditedByUser, setSlugEditedByUser] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    trigger,
    control,
    formState: { errors, isSubmitted, isSubmitting },
  } = useForm<CreateRestaurantInput>({
    resolver: zodResolver(createRestaurantSchema),
    defaultValues: { name: "", slug: "", whatsapp: "", delivery: true, takeaway: true },
  });

  const [slug, delivery, takeaway] = useWatch({ control, name: ["slug", "delivery", "takeaway"] });
  const debouncedSlug = useDebouncedValue(slug, SLUG_CHECK_DELAY_MS);
  const settled = debouncedSlug === slug;
  const localSlugCheck = slugSchema.safeParse(debouncedSlug);
  const availability = useSlugAvailability(debouncedSlug, localSlugCheck.success);

  /** The "at least one" error lives on `delivery`, so re-check it when either checkbox changes. */
  function revalidateDelivery() {
    if (isSubmitted) void trigger("delivery");
  }

  function slugStatus(): SlugStatus {
    if (errors.slug?.message) return { tone: "error", text: errors.slug.message };
    if (!slug || !settled) return null;
    if (!localSlugCheck.success) {
      return { tone: "error", text: localSlugCheck.error.issues[0]?.message ?? RESTAURANT_MESSAGES.slugInvalid };
    }
    if (availability.isPending) return { tone: "muted", text: "Verificando disponibilidad..." };
    if (availability.isError) return { tone: "error", text: "No pudimos verificar el link. Probá de nuevo." };
    if (availability.data.available) {
      return { tone: "success", text: "Disponible. Este link va en tu QR y en tus redes." };
    }
    return { tone: "error", text: UNAVAILABLE_MESSAGES[availability.data.reason ?? "taken"] };
  }

  async function onValid(values: CreateRestaurantInput) {
    // Confirm availability right before creating (cached if it was just checked).
    const check = await queryClient.fetchQuery(slugAvailabilityOptions(values.slug)).catch(() => null);
    if (check && !check.available) {
      setError("slug", { message: UNAVAILABLE_MESSAGES[check.reason ?? "taken"] }, { shouldFocus: true });
      return;
    }

    try {
      await createRestaurant.mutateAsync(values);
      navigate("/", { replace: true });
    } catch (error) {
      if (!(error instanceof ApiError)) return;
      if (error.code === "SLUG_TAKEN") {
        await queryClient.invalidateQueries({ queryKey: [...SLUG_AVAILABILITY_KEY, values.slug] });
        setError("slug", { message: RESTAURANT_MESSAGES.slugTaken }, { shouldFocus: true });
      } else if (error.code === "ALREADY_HAS_RESTAURANT") {
        // The guard sends the user to / once the refetch finds the restaurant.
        await queryClient.invalidateQueries({ queryKey: RESTAURANT_KEY });
      }
    }
  }

  const submitError =
    createRestaurant.error instanceof ApiError &&
    ["SLUG_TAKEN", "ALREADY_HAS_RESTAURANT"].includes(createRestaurant.error.code)
      ? null
      : createRestaurant.error
        ? "No pudimos crear tu local. Revisá los datos y probá de nuevo."
        : null;

  const status = slugStatus();

  return (
    <div className="box-border flex min-h-screen flex-col items-center gap-8 bg-bg px-6 py-10 text-ink">
      <span className="font-display text-2xl font-extrabold">
        menucito<span className="text-primary">.</span>
      </span>

      <div className="flex w-full max-w-[560px] flex-col gap-6">
        <div className="flex flex-col gap-2.5">
          <span className="text-[13px] font-bold text-muted">Paso 1 de 3 · Tu local</span>
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="h-1.5 flex-1 rounded-full bg-primary" />
            <span className="h-1.5 flex-1 rounded-full bg-line" />
            <span className="h-1.5 flex-1 rounded-full bg-line" />
          </div>
        </div>

        <form
          noValidate
          onSubmit={handleSubmit(onValid)}
          className="flex flex-col gap-5 rounded-[20px] border border-line bg-white p-8"
        >
          <h1 className="m-0 font-display text-[30px] leading-[1.1] font-extrabold">Contanos de tu local</h1>

          <FormField
            label="Nombre del local"
            autoComplete="organization"
            error={errors.name?.message}
            {...register("name", {
              onChange: (event: ChangeEvent<HTMLInputElement>) => {
                if (slugEditedByUser) return;
                setValue("slug", slugify(event.target.value), { shouldValidate: isSubmitted });
              },
            })}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slug">Tu link</Label>
            <div
              className={cn(
                "box-border flex h-12 items-center overflow-hidden rounded-xl border bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
                status?.tone === "error" ? "border-danger" : "border-line",
              )}
            >
              <span className="flex h-full items-center bg-addon px-3 text-[15px] text-muted">{PUBLIC_BASE}/</span>
              <input
                id="slug"
                type="text"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={status?.tone === "error" ? true : undefined}
                aria-describedby={status ? "slug-status" : undefined}
                className="h-full min-w-0 flex-1 border-0 bg-white px-3 text-base text-ink outline-none"
                {...register("slug", {
                  onChange: (event: ChangeEvent<HTMLInputElement>) => {
                    // An emptied slug goes back to following the name.
                    setSlugEditedByUser(event.target.value !== "");
                  },
                })}
              />
            </div>
            {status && (
              <p
                id="slug-status"
                aria-live="polite"
                className={cn(
                  "m-0",
                  status.tone === "error" && "text-[13px] text-danger",
                  status.tone === "success" && "text-xs text-success",
                  status.tone === "muted" && "text-xs text-muted",
                )}
              >
                {status.text}
              </p>
            )}
          </div>

          <FormField
            label="WhatsApp para recibir pedidos"
            type="tel"
            autoComplete="tel"
            placeholder="011 15 1234-5678"
            hint="Con código de área. Nosotros armamos el link internacional."
            error={errors.whatsapp?.message}
            {...register("whatsapp")}
          />

          <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0" aria-describedby={errors.delivery ? "delivery-error" : undefined}>
            <legend className="mb-2 p-0 text-[13px] font-bold">¿Cómo entregás?</legend>
            <DeliveryOption checked={takeaway} {...register("takeaway", { onChange: revalidateDelivery })}>
              Retiro en el local
            </DeliveryOption>
            <DeliveryOption checked={delivery} {...register("delivery", { onChange: revalidateDelivery })}>
              Envío a domicilio
            </DeliveryOption>
            {errors.delivery?.message && (
              <p id="delivery-error" role="alert" className="m-0 w-full text-[13px] text-danger">
                {errors.delivery.message}
              </p>
            )}
          </fieldset>

          {submitError && <Notice tone="error">{submitError}</Notice>}

          <div className="mt-1 flex justify-end">
            <Button type="submit" className="px-8" disabled={isSubmitting}>
              Continuar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DeliveryOptionProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "checked"> {
  checked: boolean;
  children: ReactNode;
}

function DeliveryOption({ checked, children, ref, ...props }: DeliveryOptionProps & { ref?: Ref<HTMLInputElement> }) {
  return (
    <label
      className={cn(
        "box-border flex min-h-12 flex-[1_1_180px] cursor-pointer items-center gap-3 rounded-xl border-2 px-3.5 text-[15px]",
        checked ? "border-primary bg-primary-soft" : "border-line bg-white",
      )}
    >
      <input ref={ref} type="checkbox" className="m-0 size-5 accent-primary" {...props} />
      {children}
    </label>
  );
}
