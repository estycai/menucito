import { useEffect, useRef, useState } from "react";
import {
  ADDRESS_LABEL_TEXT,
  customerWhatsappUrl,
  formatArs,
  formatCustomerPhone,
  formatLocalDateTime,
  localDateKey,
  type AddressLabel,
  type CustomerDetail,
  type CustomerOrderRow,
  type UpdateCustomerInput,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InfoHint } from "@/components/reports/InfoHint";
import { TagPicker } from "@/components/customers/TagPicker";
import { OrderDetailDialog } from "@/components/orders/OrderDetailDialog";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { PaymentStatusBadge } from "@/components/orders/PaymentStatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccess } from "@/lib/access";
import {
  useCreateCustomerTag,
  useCustomer,
  useCustomerOrders,
  useCustomerTags,
  useDeleteCustomer,
  useDeleteCustomerAddress,
  useUpdateCustomer,
} from "@/lib/customers";
import { useBackdropClose } from "@/lib/backdrop-close";
import { ApiError } from "@/lib/restaurant";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { cn } from "@/lib/utils";

const INDICATOR_HINTS = {
  orders: "Pedidos del cliente que no están cancelados.",
  spent: "Suma de sus ventas entregadas y pagadas, como en Reportes.",
  average: "(subtotal − descuentos) ÷ cantidad de ventas. Sin ventas muestra —.",
  first: "Fecha de su primer pedido no cancelado.",
  last: "Fecha de su último pedido no cancelado.",
} as const;

const dayLabel = (ms: number) => {
  const [year = "", month = "", day = ""] = localDateKey(ms).split("-");
  return `${day}/${month}/${year}`;
};

/** Ficha del cliente: indicadores, historial de pedidos, notas, etiquetas y direcciones. */
export function CustomerSheet({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useScrollLock();
  const { can } = useAccess();
  const detail = useCustomer(customerId);
  const tags = useCustomerTags();
  const customerTags = tags.data ?? [];
  const update = useUpdateCustomer();
  const remove = useDeleteCustomer();
  const removeAddress = useDeleteCustomerAddress();
  const createTag = useCreateCustomerTag();
  const [tab, setTab] = useState<"orders" | "notes">("orders");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", notes: "", whatsappOptOut: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const orders = useCustomerOrders(customerId, page);
  const canEdit = can("customers.edit");
  const canDelete = can("customers.delete");
  const canViewOrders = can("orders.view");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const backdropClose = useBackdropClose(onClose);
  const customer = detail.data;

  function startEditing() {
    if (!customer) return;
    setForm({
      name: customer.name,
      phone: customer.phone,
      notes: customer.notes ?? "",
      whatsappOptOut: customer.whatsappOptOut,
    });
    setFormError(null);
    setEditing(true);
  }

  function save() {
    if (!customer) return;
    setFormError(null);
    const input: UpdateCustomerInput = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      notes: form.notes.trim() || null,
      whatsappOptOut: form.whatsappOptOut,
    };
    update.mutate(
      { id: customer.id, ...input },
      {
        onSuccess: () => setEditing(false),
        onError: (error) =>
          setFormError(
            error instanceof ApiError && error.message ? error.message : "No pudimos guardar los cambios.",
          ),
      },
    );
  }

  function toggleTag(tagId: string) {
    if (!customer) return;
    const current = customer.tags.map((tag) => tag.id);
    const next = current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId];
    update.mutate({ id: customer.id, tagIds: next });
  }

  return (
    <>
      <dialog
        ref={dialogRef}
        aria-label="Ficha del cliente"
        onClose={onClose}
        {...backdropClose}
        className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto border-0 bg-bg p-4 text-ink backdrop:bg-black/40 open:block sm:m-auto sm:h-fit sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-[900px] sm:rounded-2xl sm:border sm:border-line sm:p-6 sm:shadow-2xl"
      >
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="m-0 font-display text-[26px] font-extrabold break-words">{customer?.name ?? "Cliente"}</h2>
              {customer && (
                <a
                  href={customerWhatsappUrl(customer.phone)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-link hover:underline"
                >
                  {formatCustomerPhone(customer.phone)}
                </a>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canEdit && !editing && (
                <Button type="button" variant="outline" onClick={startEditing} className="min-h-10 px-3 text-sm">
                  Editar
                </Button>
              )}
              {canDelete && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmDelete(true)}
                  className="min-h-10 px-3 text-sm text-danger"
                >
                  Eliminar
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose} aria-label="Cerrar" className="size-11 min-h-11 p-0">
                ✕
              </Button>
            </div>
          </div>

          {detail.isLoading ? (
            <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">Cargando el cliente…</div>
          ) : detail.isError || !customer ? (
            <Notice tone="error">No pudimos cargar el cliente. Cerrá y probá de nuevo.</Notice>
          ) : editing ? (
            <EditForm
              form={form}
              onChange={setForm}
              error={formError}
              pending={update.isPending}
              onCancel={() => {
                setEditing(false);
                setFormError(null);
              }}
              onSave={save}
            />
          ) : (
            <>
              <CustomerIndicators customer={customer} />

              <div role="tablist" aria-label="Ficha del cliente" className="flex gap-2">
                <Tab active={tab === "orders"} onClick={() => setTab("orders")}>
                  {`Pedidos (${customer.orders})`}
                </Tab>
                <Tab active={tab === "notes"} onClick={() => setTab("notes")}>
                  Notas y etiquetas
                </Tab>
              </div>

              {tab === "orders" ? (
                <CustomerOrders
                  rows={orders.data?.items}
                  total={orders.data?.total ?? customer.orders}
                  page={page}
                  pageSize={orders.data?.pageSize ?? 10}
                  loading={orders.isLoading}
                  canViewOrders={canViewOrders}
                  onSelect={setOrderId}
                  onPage={setPage}
                />
              ) : (
                <div className="flex flex-col gap-4">
                  <section className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
                    <h3 className="m-0 text-sm font-extrabold">Notas internas</h3>
                    <p className="m-0 whitespace-pre-wrap text-sm text-ink">
                      {customer.notes?.trim() || <span className="text-muted">Sin notas.</span>}
                    </p>
                  </section>

                  <section className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
                    <h3 className="m-0 text-sm font-extrabold">Etiquetas</h3>
                    <TagPicker
                      tags={customerTags}
                      selectedIds={customer.tags.map((tag) => tag.id)}
                      canEdit={canEdit}
                      onToggle={toggleTag}
                      onCreate={(input) => createTag.mutateAsync(input)}
                      creating={createTag.isPending}
                    />
                  </section>

                  <section className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
                    <h3 className="m-0 text-sm font-extrabold">Avisos por WhatsApp</h3>
                    <p className="m-0 text-sm text-ink">
                      {customer.whatsappOptOut
                        ? "El cliente pidió que no le escriban."
                        : customer.whatsappOptInAt
                          ? `Aceptó avisos el ${dayLabel(customer.whatsappOptInAt)} (${
                              customer.whatsappOptInSource === "web" ? "checkout del menú web" : "alta manual"
                            }).`
                          : "Sin permiso."}
                    </p>
                    {customer.whatsappOptOut && <span className="text-xs font-bold text-danger">No enviar mensajes por WhatsApp</span>}
                  </section>

                  <section className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
                    <h3 className="m-0 text-sm font-extrabold">Direcciones</h3>
                    {customer.addresses.length === 0 ? (
                      <p className="m-0 text-sm text-muted">Sin direcciones guardadas.</p>
                    ) : (
                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {customer.addresses.map((address) => (
                          <li key={address.id} className="flex items-start justify-between gap-3 rounded-xl border border-line-soft p-3">
                            <div className="flex min-w-0 flex-col">
                              <span className="text-sm font-semibold">
                                {address.label ? ADDRESS_LABEL_TEXT[address.label as AddressLabel] ?? address.label : "Dirección"}
                              </span>
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${address.lat},${address.lng}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm text-link hover:underline"
                              >
                                {address.formattedAddress}
                              </a>
                              <span className="text-xs text-muted">Último uso: {formatLocalDateTime(address.lastUsedAt)}</span>
                            </div>
                            {canEdit && (
                              <button
                                type="button"
                                disabled={removeAddress.isPending}
                                onClick={() => removeAddress.mutate({ customerId, addressId: address.id })}
                                className="shrink-0 cursor-pointer text-xs font-bold text-danger hover:underline disabled:opacity-60"
                              >
                                Borrar
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      </dialog>

      {orderId && <OrderDetailDialog orderId={orderId} onClose={() => setOrderId(null)} />}

      {confirmDelete && customer && (
        <ConfirmDialog
          title="Eliminar cliente"
          confirmLabel="Eliminar"
          danger
          pending={remove.isPending}
          error={deleteError}
          onCancel={() => {
            setConfirmDelete(false);
            setDeleteError(null);
          }}
          onConfirm={() =>
            remove.mutate(customer.id, {
              onSuccess: onClose,
              onError: () => setDeleteError("No pudimos eliminar el cliente. Probá de nuevo."),
            })
          }
        >
          ¿Eliminar a {customer.name}? Se borran sus datos y direcciones. Sus pedidos quedan como "Cliente eliminado". No
          se puede deshacer.
        </ConfirmDialog>
      )}
    </>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "min-h-11 cursor-pointer rounded-xl border px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-primary",
        active ? "border-primary bg-primary-soft text-ink" : "border-line bg-white text-muted",
      )}
    >
      {children}
    </button>
  );
}

function CustomerIndicators({ customer }: { customer: CustomerDetail }) {
  const cards = [
    { label: "Pedidos", value: String(customer.orders), hint: INDICATOR_HINTS.orders },
    { label: "Gasto total", value: formatArs(customer.spentCents), hint: INDICATOR_HINTS.spent },
    {
      label: "Ticket promedio",
      value: customer.averageTicketCents === null ? "—" : formatArs(customer.averageTicketCents),
      hint: INDICATOR_HINTS.average,
    },
    {
      label: "Primer pedido",
      value: customer.firstOrderAt === null ? "—" : dayLabel(customer.firstOrderAt),
      hint: INDICATOR_HINTS.first,
    },
    {
      label: "Último pedido",
      value: customer.lastOrderAt === null ? "—" : dayLabel(customer.lastOrderAt),
      hint: INDICATOR_HINTS.last,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <div key={card.label} className="flex flex-col gap-1 rounded-2xl border border-line bg-white p-4">
          <span className="flex items-center gap-1 text-xs text-muted">
            {card.label}
            <InfoHint label={card.label}>{card.hint}</InfoHint>
          </span>
          <span className="font-display text-xl font-extrabold">{card.value}</span>
        </div>
      ))}
    </div>
  );
}

function CustomerOrders({
  rows,
  total,
  page,
  pageSize,
  loading,
  canViewOrders,
  onSelect,
  onPage,
}: {
  rows: CustomerOrderRow[] | undefined;
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  canViewOrders: boolean;
  onSelect: (id: string) => void;
  onPage: (page: number) => void;
}) {
  if (loading && !rows) {
    return <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">Cargando pedidos…</div>;
  }
  if (!rows || rows.length === 0) {
    return <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">Todavía no tiene pedidos.</div>;
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white sm:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-3 font-bold">Pedido</th>
              <th className="px-4 py-3 font-bold">Fecha</th>
              <th className="px-4 py-3 font-bold">Productos</th>
              <th className="px-4 py-3 font-bold">Pago</th>
              <th className="px-4 py-3 font-bold">Estado</th>
              <th className="px-4 py-3 text-right font-bold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  {canViewOrders ? (
                    <button type="button" onClick={() => onSelect(row.id)} className="cursor-pointer font-bold text-link hover:underline">
                      #{row.number}
                    </button>
                  ) : (
                    <span className="font-bold">#{row.number}</span>
                  )}
                  <span className="ml-1.5 text-xs text-muted">{row.fulfillment === "delivery" ? "Envío" : "Retiro"}</span>
                </td>
                <td className="px-4 py-3 text-muted">{formatLocalDateTime(row.createdAt)}</td>
                <td className="max-w-[240px] px-4 py-3 text-muted">{productsText(row)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{row.paymentMethod === "cash" ? "Efectivo" : row.paymentMethod === "transfer" ? "Transferencia" : "Dividir pago"}</span>
                    <PaymentStatusBadge status={row.paymentStatus} />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <OrderStatusBadge status={row.status} />
                </td>
                <td className="px-4 py-3 text-right font-bold tabular-nums">{formatArs(row.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 sm:hidden">
        {rows.map((row) => (
          <article key={row.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              {canViewOrders ? (
                <button type="button" onClick={() => onSelect(row.id)} className="cursor-pointer font-bold text-link hover:underline">
                  #{row.number}
                </button>
              ) : (
                <span className="font-bold">#{row.number}</span>
              )}
              <span className="font-bold tabular-nums">{formatArs(row.totalCents)}</span>
            </div>
            <span className="text-xs text-muted">{formatLocalDateTime(row.createdAt)}</span>
            <span className="text-sm text-muted">{productsText(row)}</span>
            <div className="flex items-center gap-2">
              <PaymentStatusBadge status={row.paymentStatus} />
              <OrderStatusBadge status={row.status} />
            </div>
          </article>
        ))}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)} className="min-h-10 px-4 text-sm">
            Anterior
          </Button>
          <span className="text-sm text-muted">
            Página {page} de {pages}
          </span>
          <Button type="button" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)} className="min-h-10 px-4 text-sm">
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}

function productsText(row: CustomerOrderRow): string {
  const shown = row.items.map((item) => `${item.quantity}× ${item.name}`).join(", ");
  const shownUnits = row.items.reduce((sum, item) => sum + item.quantity, 0);
  return shownUnits < row.itemCount ? `${shown} (+${row.itemCount - shownUnits})` : shown || "—";
}

function EditForm({
  form,
  onChange,
  error,
  pending,
  onCancel,
  onSave,
}: {
  form: { name: string; phone: string; notes: string; whatsappOptOut: boolean };
  onChange: (form: { name: string; phone: string; notes: string; whatsappOptOut: boolean }) => void;
  error: string | null;
  pending: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-bold">Nombre</span>
        <Input value={form.name} maxLength={60} onChange={(event) => onChange({ ...form, name: event.target.value })} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-bold">Teléfono</span>
        <Input value={form.phone} inputMode="tel" onChange={(event) => onChange({ ...form, phone: event.target.value })} />
        <span className="text-xs text-muted">Número de Argentina, con código de área.</span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-bold">Notas internas</span>
        <textarea
          value={form.notes}
          rows={3}
          maxLength={1000}
          onChange={(event) => onChange({ ...form, notes: event.target.value })}
          className="box-border w-full resize-y rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </label>
      <label className="flex items-start gap-2.5 rounded-xl border border-line bg-bg/50 px-3.5 py-3">
        <input
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 accent-primary"
          checked={form.whatsappOptOut}
          onChange={(event) => onChange({ ...form, whatsappOptOut: event.target.checked })}
        />
        <span className="text-sm font-semibold">No enviar mensajes por WhatsApp</span>
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} className="min-h-11 px-5">
          Cancelar
        </Button>
        <Button type="button" disabled={pending} onClick={onSave} className="min-h-11 px-5 text-sm">
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </div>
  );
}

