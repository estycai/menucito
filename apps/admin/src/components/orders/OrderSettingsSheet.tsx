import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ORDER_MESSAGE_BODY_MAX_LENGTH,
  ORDER_MESSAGE_VARIABLES,
  orderMessageTemplatesSchema,
  type OrderMessageTemplate,
  type OrderMessageTemplatesInput,
  type OrderMessageTemplateList,
} from "@menucito/shared";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Notice } from "@/components/AuthLayout";
import { QueryError } from "@/components/QueryError";
import { Button } from "@/components/ui/button";
import { useBackdropClose } from "@/lib/backdrop-close";
import { useOrderMessages, useSaveOrderMessages } from "@/lib/order-messages";
import { ApiError } from "@/lib/restaurant";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { cn } from "@/lib/utils";

interface Slot {
  fulfillment: OrderMessageTemplate["fulfillment"];
  targetStatus: OrderMessageTemplate["targetStatus"];
  label: string;
  placeholder: string;
}

const SLOTS: readonly Slot[] = [
  {
    fulfillment: "delivery",
    targetStatus: "preparing",
    label: "Nuevo → En preparación",
    placeholder: "Hola {nombre}, tu pedido ya está en preparación",
  },
  {
    fulfillment: "delivery",
    targetStatus: "ready",
    label: "En preparación → Listo",
    placeholder: "Hola {nombre}, tu pedido ya está listo",
  },
  {
    fulfillment: "delivery",
    targetStatus: "sent",
    label: "Listo → Enviado",
    placeholder: "Hola {nombre}, tu pedido está en camino",
  },
  {
    fulfillment: "delivery",
    targetStatus: "delivered",
    label: "Enviado → Entregado",
    placeholder: "Hola {nombre}, tu pedido fue entregado. ¡Gracias!",
  },
  {
    fulfillment: "delivery",
    targetStatus: "cancelled",
    label: "De cualquier estado → Cancelado",
    placeholder: "Hola {nombre}, tu pedido fue cancelado",
  },
  {
    fulfillment: "takeaway",
    targetStatus: "preparing",
    label: "Nuevo → En preparación",
    placeholder: "Hola {nombre}, tu pedido ya está en preparación",
  },
  {
    fulfillment: "takeaway",
    targetStatus: "ready",
    label: "En preparación → Listo",
    placeholder: "Hola {nombre}, tu pedido ya está listo para retirar",
  },
  {
    fulfillment: "takeaway",
    targetStatus: "delivered",
    label: "Listo → Entregado",
    placeholder: "Hola {nombre}, tu pedido fue entregado. ¡Gracias!",
  },
  {
    fulfillment: "takeaway",
    targetStatus: "cancelled",
    label: "De cualquier estado → Cancelado",
    placeholder: "Hola {nombre}, tu pedido fue cancelado",
  },
];

function defaultsFrom(data: OrderMessageTemplateList | undefined): OrderMessageTemplatesInput {
  return {
    templates: SLOTS.map((slot) => ({
      fulfillment: slot.fulfillment,
      targetStatus: slot.targetStatus,
      body: data?.templates.find(
        (template) => template.fulfillment === slot.fulfillment && template.targetStatus === slot.targetStatus,
      )?.body ?? "",
    })),
  };
}

/** Side panel of "Ajustes de pedidos": the messages kept for each status change. */
export function OrderSettingsSheet({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const query = useOrderMessages();
  const mutation = useSaveOrderMessages();
  const textareas = useRef<Array<HTMLTextAreaElement | null>>([]);
  const lastFocused = useRef(0);
  const loaded = useRef(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useScrollLock();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<OrderMessageTemplatesInput>({
    resolver: zodResolver(orderMessageTemplatesSchema),
    defaultValues: defaultsFrom(undefined),
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (!query.data || loaded.current) return;
    reset(defaultsFrom(query.data));
    loaded.current = true;
  }, [query.data, reset]);

  function requestClose() {
    if (isDirty) setConfirmClose(true);
    else close();
  }

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  function insertVariable(token: string) {
    const index = lastFocused.current;
    const name = `templates.${index}.body` as const;
    const textarea = textareas.current[index];
    const value = getValues(name) ?? "";
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    setValue(name, `${value.slice(0, start)}${token}${value.slice(end)}`, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setSaved(false);
    // Put the cursor after the inserted token once React has written the value.
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setSaved(false);
    try {
      const result = await mutation.mutateAsync(values);
      reset(defaultsFrom(result));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No pudimos guardar los mensajes. Probá de nuevo.");
    }
  });

  const backdropClose = useBackdropClose(requestClose);

  return (
    <>
      <dialog
        ref={dialogRef}
        aria-label="Ajustes de pedidos"
        onClose={onClose}
        onCancel={(event) => {
          if (!isDirty) return;
          event.preventDefault();
          setConfirmClose(true);
        }}
        {...backdropClose}
        className="fixed inset-y-0 right-0 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto border-0 bg-white p-5 text-ink shadow-2xl backdrop:bg-black/40 open:block sm:w-[480px] sm:p-6"
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
            <h2 className="m-0 font-display text-xl font-extrabold">Ajustes de pedidos</h2>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Cerrar"
              className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          {query.isLoading ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              {SLOTS.map((slot, index) => (
                <div key={index} className="h-24 animate-pulse rounded-xl bg-bg" />
              ))}
            </div>
          ) : query.isError ? (
            <QueryError
              message="No pudimos cargar los mensajes. Probá de nuevo."
              onRetry={() => void query.refetch()}
              retrying={query.isRefetching}
            />
          ) : (
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
              {(["delivery", "takeaway"] as const).map((fulfillment) => (
                <section key={fulfillment} className="flex flex-col gap-3">
                  <div>
                    <h3 className="m-0 text-base font-extrabold">
                      {fulfillment === "delivery" ? "Mensajes para Delivery (por defecto)" : "Variantes para Take Away"}
                    </h3>
                    {fulfillment === "takeaway" && (
                      <p className="m-0 mt-1 text-xs text-muted">Si lo dejás vacío, se usa el mensaje de Delivery.</p>
                    )}
                  </div>

                  {SLOTS.map((slot, index) => {
                    if (slot.fulfillment !== fulfillment) return null;
                    const bodyError = errors.templates?.[index]?.body?.message;
                    const field = register(`templates.${index}.body`);
                    return (
                      <label key={index} className="flex flex-col gap-1.5">
                        <span className="text-[13px] font-bold text-ink">{slot.label}</span>
                        <textarea
                          {...field}
                          ref={(element) => {
                            field.ref(element);
                            textareas.current[index] = element;
                          }}
                          onFocus={() => {
                            lastFocused.current = index;
                          }}
                          maxLength={ORDER_MESSAGE_BODY_MAX_LENGTH}
                          rows={3}
                          placeholder={slot.placeholder}
                          aria-invalid={bodyError ? true : undefined}
                          aria-describedby={bodyError ? `order-message-${index}-error` : undefined}
                          className={cn(
                            "box-border w-full resize-y rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20",
                            bodyError && "border-danger",
                          )}
                        />
                        {bodyError && (
                          <p id={`order-message-${index}-error`} className="m-0 text-[13px] text-danger">
                            {bodyError}
                          </p>
                        )}
                      </label>
                    );
                  })}

                  {fulfillment === "delivery" && (
                    <div className="flex flex-col gap-1.5 rounded-xl bg-bg/60 p-3">
                      <span className="text-xs font-bold text-muted">Variables</span>
                      <div className="flex flex-wrap gap-2">
                        {ORDER_MESSAGE_VARIABLES.map((variable) => (
                          <button
                            key={variable.token}
                            type="button"
                            onClick={() => insertVariable(variable.token)}
                            className="min-h-9 cursor-pointer rounded-lg border border-line bg-white px-2.5 text-xs font-bold text-ink hover:bg-tab focus-visible:outline-2 focus-visible:outline-primary"
                          >
                            {variable.token}
                          </button>
                        ))}
                      </div>
                      <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 text-xs text-muted">
                        {ORDER_MESSAGE_VARIABLES.map((variable) => (
                          <li key={variable.token}>
                            {variable.token}: {variable.description}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              ))}

              {error && <Notice tone="error">{error}</Notice>}
              <div aria-live="polite">{saved && <Notice tone="success">Guardado</Notice>}</div>

              <Button
                type="submit"
                disabled={mutation.isPending || isSubmitting}
                className="min-h-11 w-full text-sm font-bold"
              >
                {mutation.isPending ? "Guardando…" : "Guardar"}
              </Button>
            </form>
          )}
        </div>
      </dialog>

      {confirmClose && (
        <ConfirmDialog
          title="Cambios sin guardar"
          confirmLabel="Cerrar igual"
          onConfirm={close}
          onCancel={() => setConfirmClose(false)}
        >
          Tenés cambios sin guardar. ¿Cerrar igual?
        </ConfirmDialog>
      )}
    </>
  );
}
