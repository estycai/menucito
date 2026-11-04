import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  CART_MESSAGES,
  FULFILLMENT_LABELS,
  MAX_LINE_QUANTITY,
  ORDER_ADDRESS_MAX_LENGTH,
  ORDER_NAME_MAX_LENGTH,
  PAYMENT_LABELS,
  cartTotalCents,
  describeChanges,
  formatArs,
  lineTotalCents,
  orderTotals,
  type Fulfillment,
  type PaymentMethod,
  type PublicMenu,
  type PublicMenuPaymentMethod,
} from "@menucito/shared";
import { browserStorage } from "../lib/cart-store";
import { toCatalog, type CatalogProduct } from "../lib/catalog";
import { buildOrderRequest } from "../lib/order-api";
import {
  EMPTY_ORDER_FORM,
  getFormErrors,
  minOrderShortfallCents,
  offeredFulfillments,
  readOrderForm,
  writeOrderForm,
  type OrderFormField,
  type OrderFormValues,
} from "../lib/order-form";
import { useCart } from "../lib/use-cart";
import { useOrderSubmit } from "../lib/use-order-submit";
import { OrderConfirmation } from "./OrderConfirmation";
import { Stepper } from "./Stepper";

interface OrderDetailProps {
  slug: string;
  delivery: boolean;
  takeaway: boolean;
  products: CatalogProduct[];
  acceptingOrders: boolean;
  minOrderCents: number | null;
  shippingCents: number;
  paymentMethods: PublicMenuPaymentMethod[];
  apiUrl: string;
}

/** The store rules the page works with: the server-rendered ones, replaced by a fresh menu after a conflict. */
interface LiveStore {
  delivery: boolean;
  takeaway: boolean;
  products: CatalogProduct[];
  acceptingOrders: boolean;
  minOrderCents: number | null;
  shippingCents: number;
  paymentMethods: PublicMenuPaymentMethod[];
}

function liveStoreFromMenu(menu: PublicMenu): LiveStore {
  const { restaurant } = menu;
  return {
    delivery: restaurant.delivery,
    takeaway: restaurant.takeaway,
    products: toCatalog(menu),
    acceptingOrders: restaurant.acceptingOrders,
    minOrderCents: restaurant.minOrderCents,
    shippingCents: restaurant.shippingCents,
    paymentMethods: restaurant.paymentMethods,
  };
}

const PHONE_HELP_ID = "order-phone-help";

const FIELD_IDS: Record<OrderFormField, string> = {
  name: "order-name",
  phone: "order-phone",
  fulfillment: "order-fulfillment",
  address: "order-address",
  payment: "order-payment",
};

/** Order review, store policy validation, and submission with WhatsApp handoff. */
export function OrderDetail({ slug, apiUrl, ...initialStore }: OrderDetailProps) {
  const [live, setLive] = useState<LiveStore>(initialStore);
  const { delivery, takeaway, products, acceptingOrders, minOrderCents, shippingCents, paymentMethods } = live;
  const { state, store } = useCart(slug, initialStore.products);
  const priced = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const offered = useMemo(() => offeredFulfillments({ delivery, takeaway }), [delivery, takeaway]);
  const offeredMethods = useMemo(() => paymentMethods.map((p) => p.method), [paymentMethods]);
  const transferMethod = useMemo(() => paymentMethods.find((p) => p.method === "transfer"), [paymentMethods]);

  const regionRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const hadLines = useRef(false);

  const [values, setValues] = useState<OrderFormValues>(EMPTY_ORDER_FORM);
  const [restored, setRestored] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<OrderFormField>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  // Read the remembered form after hydration. Single available choices are preselected.
  useEffect(() => {
    const saved = readOrderForm(browserStorage(), slug, offered, offeredMethods);
    setValues({
      ...saved,
      fulfillment: offered.length === 1 ? (offered[0] ?? "") : saved.fulfillment,
      payment: offeredMethods.length === 1 ? (offeredMethods[0] ?? "") : saved.payment,
    });
    setRestored(true);
  }, [slug, offered, offeredMethods]);

  useEffect(() => {
    if (restored) writeOrderForm(browserStorage(), slug, values);
  }, [restored, slug, values]);

  // Removing the last line unmounts the list; keep keyboard focus inside the page.
  useEffect(() => {
    if (state.lines.length > 0) hadLines.current = true;
    else if (hadLines.current) emptyRef.current?.focus();
  }, [state.lines.length]);

  const change = (patch: Partial<OrderFormValues>) => setValues((current) => ({ ...current, ...patch }));
  const touch = (field: OrderFormField) => setTouched((current) => new Set(current).add(field));

  /** Clears a choice the store no longer accepts, in the form and in the remembered copy. */
  const resetChoice = (field: "payment" | "fulfillment") => {
    const next = { ...values, [field]: "" };
    // Not redundant with the persist effect: the fresh menu changes `offered`/`offeredMethods`, so the
    // restore effect runs first in the same commit and would read the old choice back from storage.
    writeOrderForm(browserStorage(), slug, next);
    setValues(next);
    touch(field);
  };

  const orderSubmit = useOrderSubmit({
    slug,
    apiUrl,
    cart: store,
    onMenu: (menu) => setLive(liveStoreFromMenu(menu)),
    onPaused: () => setLive((current) => ({ ...current, acceptingOrders: false })),
    onChoiceRejected: resetChoice,
  });
  const { submitting, submitError, successOrder, menuRefreshed } = orderSubmit;

  const errors = getFormErrors(values, offered, offeredMethods);
  const visibleError = (field: OrderFormField) => (submitted || touched.has(field) ? errors[field] : undefined);
  const describedBy = (field: OrderFormField) => (visibleError(field) ? `${FIELD_IDS[field]}-error` : undefined);

  if (successOrder) return <OrderConfirmation response={successOrder} />;

  if (!state.ready) return <p class="order-status">Cargando tu pedido…</p>;

  if (state.lines.length === 0) {
    return (
      <div class="order-empty" ref={emptyRef} tabIndex={-1}>
        {state.notice && <Notice onDismiss={() => store.dismissNotice()} />}
        <p class="order-status">Tu pedido está vacío.</p>
        <a class="primary-button" href={`/${slug}`}>
          Volver al menú
        </a>
      </div>
    );
  }

  const totals = orderTotals({
    subtotalCents: cartTotalCents(state.lines, priced),
    shippingCents,
    // Until a fulfillment is picked, the total is shown without shipping.
    fulfillment: values.fulfillment === "delivery" ? "delivery" : "takeaway",
  });
  const shortfall = minOrderShortfallCents(totals.subtotalCents, minOrderCents);
  const isBelowMinOrder = shortfall !== null;

  const submit = (event: Event) => {
    event.preventDefault();
    if (orderSubmit.isSending()) return;
    setSubmitted(true);
    orderSubmit.clearError();

    const firstInvalid = (Object.keys(FIELD_IDS) as OrderFormField[]).find((field) => errors[field]);
    if (firstInvalid) {
      document.getElementById(FIELD_IDS[firstInvalid])?.focus();
      return;
    }

    if (!acceptingOrders || isBelowMinOrder) return;

    void orderSubmit.send((clientOrderId) => buildOrderRequest(values, state.lines, clientOrderId, totals.totalCents));
  };

  return (
    <div class="order" ref={regionRef} tabIndex={-1}>
      {!acceptingOrders && (
        <aside class="pause-banner" role="status">
          Este local no está recibiendo pedidos por ahora. <a href={`/${slug}`}>Podés ver el menú</a>.
        </aside>
      )}

      {(state.notice || menuRefreshed) && (
        <Notice
          onDismiss={() => {
            store.dismissNotice();
            orderSubmit.dismissMenuRefreshed();
          }}
        />
      )}

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

      <dl class="order-breakdown">
        <div class="order-breakdown-row">
          <dt>Subtotal</dt>
          <dd>{formatArs(totals.subtotalCents)}</dd>
        </div>
        {values.fulfillment === "delivery" &&
          (shippingCents > 0 ? (
            <div class="order-breakdown-row">
              <dt>Envío</dt>
              <dd>{formatArs(shippingCents)}</dd>
            </div>
          ) : (
            <div class="order-breakdown-row">
              <dt>Envío gratis</dt>
            </div>
          ))}
        <div class="order-breakdown-total">
          <dt>Total</dt>
          <dd aria-live="polite" aria-atomic="true">
            <strong>{formatArs(totals.totalCents)}</strong>
          </dd>
        </div>
      </dl>

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

        <div class="field">
          <label for={FIELD_IDS.phone}>Tu teléfono</label>
          <input
            id={FIELD_IDS.phone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={30}
            value={values.phone}
            required
            aria-required="true"
            aria-invalid={visibleError("phone") ? "true" : undefined}
            aria-describedby={[PHONE_HELP_ID, describedBy("phone")].filter(Boolean).join(" ")}
            onInput={(event) => change({ phone: event.currentTarget.value })}
            onBlur={() => touch("phone")}
          />
          <p class="field-help" id={PHONE_HELP_ID}>
            Usá un número de WhatsApp de Argentina, con código de área
          </p>
          <FieldError id={`${FIELD_IDS.phone}-error`} message={visibleError("phone")} />
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

        {offeredMethods.length === 1 ? (
          <p class="field-fixed">
            Forma de pago: <strong>{PAYMENT_LABELS[offeredMethods[0] as PaymentMethod]}</strong>
          </p>
        ) : (
          <fieldset class="field" id={FIELD_IDS.payment} tabIndex={-1} aria-describedby={describedBy("payment")}>
            <legend>Forma de pago</legend>
            <div class="choices">
              {offeredMethods.map((method) => (
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
        )}

        {values.payment === "transfer" && (
          <div class="order-transfer-box">
            {transferMethod && (transferMethod.alias || transferMethod.holderName) ? (
              <p>
                Transferí a:{" "}
                {transferMethod.alias && (
                  <>
                    Alias: <strong>{transferMethod.alias}</strong>
                  </>
                )}
                {transferMethod.alias && transferMethod.holderName && " · "}
                {transferMethod.holderName && (
                  <>
                    Titular: <strong>{transferMethod.holderName}</strong>
                  </>
                )}
              </p>
            ) : (
              <p>El local te pasa los datos por WhatsApp</p>
            )}
          </div>
        )}

        <div aria-live="polite" aria-atomic="true">
          {shortfall !== null && minOrderCents !== null && (
            <p class="order-min-warning">
              El pedido mínimo es {formatArs(minOrderCents)}. Te faltan {formatArs(shortfall)}.
            </p>
          )}
        </div>

        {submitError && (
          <p class="field-error" role="alert">
            {submitError}
          </p>
        )}

        <button
          type="submit"
          class="primary-button"
          disabled={submitting || !acceptingOrders || isBelowMinOrder}
        >
          {submitting ? "Enviando…" : !acceptingOrders ? "Recepción pausada" : "Enviar pedido"}
        </button>
        <p class="order-note">Al enviar, se abrirá WhatsApp con el detalle de tu pedido para coordinar con el local.</p>
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
