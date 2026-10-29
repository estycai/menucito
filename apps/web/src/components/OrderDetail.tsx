import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  CART_MESSAGES,
  FULFILLMENT_LABELS,
  MAX_LINE_QUANTITY,
  ORDER_ADDRESS_MAX_LENGTH,
  ORDER_NAME_MAX_LENGTH,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  cartTotalCents,
  describeChanges,
  formatArs,
  lineTotalCents,
  orderDetailsErrors,
  type Fulfillment,
  type OrderField,
} from "@menucito/shared";
import { browserStorage } from "../lib/cart-store";
import type { CatalogProduct } from "../lib/catalog";
import { EMPTY_ORDER_FORM, offeredFulfillments, readOrderForm, writeOrderForm, type OrderFormValues } from "../lib/order-form";
import { useCart } from "../lib/use-cart";
import { Stepper } from "./Stepper";

interface OrderDetailProps {
  slug: string;
  delivery: boolean;
  takeaway: boolean;
  products: CatalogProduct[];
}

const FIELD_IDS = {
  name: "order-name",
  fulfillment: "order-fulfillment",
  address: "order-address",
  payment: "order-payment",
} as const satisfies Record<OrderField, string>;

/** Order review and form: the last step before the WhatsApp message, which is not wired yet. */
export function OrderDetail({ slug, delivery, takeaway, products }: OrderDetailProps) {
  const { state, store } = useCart(slug, products);
  const priced = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const offered = useMemo(() => offeredFulfillments({ delivery, takeaway }), [delivery, takeaway]);
  const regionRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const hadLines = useRef(false);

  const [values, setValues] = useState<OrderFormValues>(EMPTY_ORDER_FORM);
  const [restored, setRestored] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<OrderField>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  // Read the remembered form after hydration (the server render has none). A single available option is preselected.
  useEffect(() => {
    const saved = readOrderForm(browserStorage(), slug, offered);
    setValues({ ...saved, fulfillment: offered.length === 1 ? (offered[0] ?? "") : saved.fulfillment });
    setRestored(true);
  }, [slug, offered]);

  useEffect(() => {
    if (restored) writeOrderForm(browserStorage(), slug, values);
  }, [restored, slug, values]);

  // Removing the last line unmounts the list; keep keyboard focus inside the page.
  useEffect(() => {
    if (state.lines.length > 0) hadLines.current = true;
    else if (hadLines.current) emptyRef.current?.focus();
  }, [state.lines.length]);

  const change = (patch: Partial<OrderFormValues>) => setValues((current) => ({ ...current, ...patch }));
  const touch = (field: OrderField) => setTouched((current) => new Set(current).add(field));

  // The address is only part of a delivery order.
  const errors = orderDetailsErrors({
    ...values,
    address: values.fulfillment === "delivery" ? values.address : "",
  });
  const valid = Object.keys(errors).length === 0;
  const visibleError = (field: OrderField) => (submitted || touched.has(field) ? errors[field] : undefined);
  const describedBy = (field: OrderField) => (visibleError(field) ? `${FIELD_IDS[field]}-error` : undefined);

  if (!state.ready) return <p class="order-status">Cargando tu pedido…</p>;

  if (state.lines.length === 0) {
    return (
      <div class="order-empty" ref={emptyRef} tabIndex={-1}>
        {state.notice && <Notice onDismiss={() => store.dismissNotice()} />}
        <p class="order-status">Tu pedido está vacío.</p>
        <a class="button-link" href={`/${slug}`}>
          Volver al menú
        </a>
      </div>
    );
  }

  const total = cartTotalCents(state.lines, priced);

  const submit = (event: Event) => {
    event.preventDefault();
    setSubmitted(true);
    // Move to the first field that needs attention.
    const firstInvalid = (Object.keys(FIELD_IDS) as OrderField[]).find((field) => errors[field]);
    if (firstInvalid) document.getElementById(FIELD_IDS[firstInvalid])?.focus();
  };

  return (
    <div class="order" ref={regionRef} tabIndex={-1}>
      {state.notice && <Notice onDismiss={() => store.dismissNotice()} />}

      <ul class="order-lines">
        {state.lines.map((line) => {
          const product = priced.get(line.productId);
          if (!product) return null;
          const changes = describeChanges(product.ingredients, line.choices);
          return (
            <li class="order-line" key={line.key}>
              <div class="order-line-main">
                <h3 class="order-line-name">{product.name}</h3>
                {changes.length > 0 && (
                  <ul class="order-line-changes">
                    {changes.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div class="order-line-controls">
                <Stepper
                  name={product.name}
                  value={line.quantity}
                  min={1}
                  max={MAX_LINE_QUANTITY}
                  onChange={(value) => store.setQuantity(line.key, value)}
                />
                <span class="order-line-total" aria-live="polite" aria-atomic="true">
                  {formatArs(lineTotalCents(product, line.choices, line.quantity))}
                </span>
                <button
                  type="button"
                  class="text-button"
                  aria-label={`Quitar ${product.name} del pedido`}
                  onClick={() => {
                    store.remove(line.key);
                    regionRef.current?.focus();
                  }}
                >
                  Quitar
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p class="order-total">
        <span>Total</span>
        <strong aria-live="polite" aria-atomic="true">
          {formatArs(total)}
        </strong>
      </p>

      <form class="order-form" noValidate onSubmit={submit}>
        <h2 class="order-form-title">Tus datos</h2>

        <div class="field">
          <label for={FIELD_IDS.name}>Tu nombre</label>
          <input
            id={FIELD_IDS.name}
            type="text"
            autoComplete="name"
            maxLength={ORDER_NAME_MAX_LENGTH}
            value={values.name}
            required
            aria-required="true"
            aria-invalid={visibleError("name") ? "true" : undefined}
            aria-describedby={describedBy("name")}
            onInput={(event) => change({ name: event.currentTarget.value })}
            onBlur={() => touch("name")}
          />
          <FieldError id={`${FIELD_IDS.name}-error`} message={visibleError("name")} />
        </div>

        {offered.length === 1 ? (
          <p class="field-fixed">
            Entrega: <strong>{FULFILLMENT_LABELS[offered[0] as Fulfillment]}</strong>
          </p>
        ) : (
          <fieldset
            class="field"
            id={FIELD_IDS.fulfillment}
            tabIndex={-1}
            aria-describedby={describedBy("fulfillment")}
          >
            <legend>Retiro o envío</legend>
            <div class="choices">
              {offered.map((option) => (
                <label class="choice" key={option}>
                  <input
                    type="radio"
                    name="fulfillment"
                    value={option}
                    checked={values.fulfillment === option}
                    onChange={() => {
                      change({ fulfillment: option });
                      touch("fulfillment");
                    }}
                  />
                  <span>{FULFILLMENT_LABELS[option]}</span>
                </label>
              ))}
            </div>
            <FieldError id={`${FIELD_IDS.fulfillment}-error`} message={visibleError("fulfillment")} />
          </fieldset>
        )}

        {values.fulfillment === "delivery" && (
          <div class="field">
            <label for={FIELD_IDS.address}>Dirección</label>
            <input
              id={FIELD_IDS.address}
              type="text"
              autoComplete="street-address"
              maxLength={ORDER_ADDRESS_MAX_LENGTH}
              value={values.address}
              required
              aria-required="true"
              aria-invalid={visibleError("address") ? "true" : undefined}
              aria-describedby={describedBy("address")}
              onInput={(event) => change({ address: event.currentTarget.value })}
              onBlur={() => touch("address")}
            />
            <FieldError id={`${FIELD_IDS.address}-error`} message={visibleError("address")} />
          </div>
        )}

        <fieldset class="field" id={FIELD_IDS.payment} tabIndex={-1} aria-describedby={describedBy("payment")}>
          <legend>Forma de pago</legend>
          <div class="choices">
            {PAYMENT_METHODS.map((method) => (
              <label class="choice" key={method}>
                <input
                  type="radio"
                  name="payment"
                  value={method}
                  checked={values.payment === method}
                  onChange={() => {
                    change({ payment: method });
                    touch("payment");
                  }}
                />
                <span>{PAYMENT_LABELS[method]}</span>
              </label>
            ))}
          </div>
          <FieldError id={`${FIELD_IDS.payment}-error`} message={visibleError("payment")} />
        </fieldset>

        {/* Enabled while something is missing so a tap shows what; disabled once everything is valid, because sending is not wired yet. */}
        <button type="submit" class="primary-button" disabled={valid}>
          Enviar pedido
        </button>
        <p class="order-note">El envío por WhatsApp llega en el próximo paso.</p>
      </form>
    </div>
  );
}

function Notice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div class="inline-notice" role="status">
      <p>{CART_MESSAGES.menuChanged}</p>
      <button type="button" class="text-button" onClick={onDismiss}>
        Entendido
      </button>
    </div>
  );
}

/** Always in the DOM so the polite live region announces the text when it appears. */
function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return (
    <p class="field-error" id={id} aria-live="polite">
      {message}
    </p>
  );
}
