import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { type CartLine, type OrderDelivery } from "@menucito/shared";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { QueryError } from "@/components/QueryError";
import { NewOrderCartStep } from "@/components/orders/new-order/NewOrderCartStep";
import { NewOrderDetailsStep } from "@/components/orders/new-order/NewOrderDetailsStep";
import { Button } from "@/components/ui/button";
import { useBackdropClose } from "@/lib/backdrop-close";
import {
  buildManualOrderBody,
  newOrderDetailsSchema,
  shouldConfirmClose,
  type NewOrderFormValues,
} from "@/lib/new-order";
import { useCreateManualOrder, useNewOrderMenu } from "@/lib/new-order-api";
import { ApiError } from "@/lib/restaurant";
import { useScrollLock } from "@/lib/use-scroll-lock";

/** Full-screen popup to load an order that arrived at the counter or by WhatsApp. */
export function NewOrderDialog({ slug, onClose }: { slug: string | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"details" | "cart">("details");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [delivery, setDelivery] = useState<OrderDelivery | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id for every retry of this popup; a new popup gets a new one.
  const [clientOrderId] = useState(() => crypto.randomUUID());
  useScrollLock();

  const menu = useNewOrderMenu(slug);
  const createOrder = useCreateManualOrder();
  const form = useForm<NewOrderFormValues>({
    defaultValues: {
      fulfillment: "delivery",
      customerName: "",
      customerPhone: "",
      address: "",
      source: "whatsapp",
      notes: "",
      paymentMethod: "cash",
      splitCash: "",
      cashTendered: "",
      markPaid: false,
      tipCents: 0,
    },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // A store with a single fulfillment or a single active payment method starts with it.
  useEffect(() => {
    const restaurant = menu.data?.restaurant;
    if (!restaurant) return;
    const offered = [
      ...(restaurant.delivery ? (["delivery"] as const) : []),
      ...(restaurant.takeaway ? (["takeaway"] as const) : []),
    ];
    if (offered.length > 0 && !offered.includes(form.getValues("fulfillment"))) {
      form.setValue("fulfillment", offered[0]!);
    }
    const methods = restaurant.paymentMethods.map((method) => method.method);
    if (methods.length > 0 && !methods.includes(form.getValues("paymentMethod"))) {
      form.setValue("paymentMethod", methods[0]!);
    }
  }, [menu.data, form]);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  function requestClose() {
    if (shouldConfirmClose(lines)) setConfirmClose(true);
    else close();
  }

  function handleContinue() {
    const values = form.getValues();
    const result = newOrderDetailsSchema.safeParse(values);
    form.clearErrors();
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string") {
          form.setError(field as keyof NewOrderFormValues, { message: issue.message });
        }
      }
      return;
    }
    if (values.fulfillment === "delivery" && menu.data?.restaurant.deliveryMode === "zones" && !delivery) {
      form.setError("address", { message: "Elegí una dirección de la lista" });
      return;
    }
    setError(null);
    setStep("cart");
  }

  async function handleCreate(input: {
    totalCents: number;
    tipCents: number;
    splitCashCents: number | null;
    cashTenderedCents: number | null;
  }) {
    if (!menu.data) return;
    setError(null);
    const body = buildManualOrderBody({
      values: form.getValues(),
      lines,
      clientOrderId,
      delivery,
      ...input,
    });
    try {
      const order = await createOrder.mutateAsync(body);
      if (order.paymentError) {
        toast.error(`El pedido N°${order.number} se creó, pero no se pudo marcar pagado.`);
      } else {
        toast.success(`Pedido N°${order.number} creado`);
      }
      close();
    } catch (err) {
      if (err instanceof ApiError && err.code === "PRICE_CHANGED") {
        // Prices changed while the employee was building the order: reload the menu and keep the cart.
        await menu.refetch();
        setError("Cambiaron los precios. Revisá el pedido.");
      } else if (err instanceof ApiError && err.code !== "UNKNOWN") {
        setError(err.message);
      } else {
        setError("No pudimos crear el pedido. Probá de nuevo.");
      }
    }
  }

  const backdropClose = useBackdropClose(requestClose);

  return (
    <>
      <dialog
        ref={dialogRef}
        aria-label="Nuevo pedido"
        onClose={onClose}
        onCancel={(event) => {
          if (!shouldConfirmClose(lines)) return;
          event.preventDefault();
          setConfirmClose(true);
        }}
        {...backdropClose}
        className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto border-0 bg-bg p-4 text-ink backdrop:bg-black/40 open:block sm:p-6"
      >
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <h1 className="m-0 font-display text-[24px] font-extrabold">Nuevo pedido</h1>
            <Button
              type="button"
              variant="outline"
              onClick={requestClose}
              aria-label="Cerrar"
              className="size-11 min-h-11 p-0"
            >
              ✕
            </Button>
          </div>

          {menu.isLoading ? (
            <div className="py-16 text-center text-muted">Cargando catálogo…</div>
          ) : menu.isError || !menu.data ? (
            <QueryError
              message="No pudimos cargar el catálogo. Probá de nuevo."
              onRetry={() => void menu.refetch()}
              retrying={menu.isRefetching}
            />
          ) : step === "details" ? (
            <NewOrderDetailsStep
              form={form}
              menu={menu.data}
              delivery={delivery}
              onDeliveryChange={setDelivery}
              onContinue={handleContinue}
            />
          ) : (
            <NewOrderCartStep
              form={form}
              menu={menu.data}
              lines={lines}
              onLinesChange={setLines}
              delivery={delivery}
              onBack={() => setStep("details")}
              onCancel={requestClose}
              onCreate={(input) => void handleCreate(input)}
              creating={createOrder.isPending}
              error={error}
            />
          )}
        </div>
      </dialog>

      {confirmClose && (
        <ConfirmDialog
          title="Pedido en curso"
          confirmLabel="Cerrar"
          onConfirm={close}
          onCancel={() => setConfirmClose(false)}
        >
          Pedido en curso. Al cerrar esta ventana, el pedido se perderá.
        </ConfirmDialog>
      )}
    </>
  );
}
