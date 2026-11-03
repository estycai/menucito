import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  CART_MESSAGES,
  FULFILLMENT_LABELS,
  MAX_LINE_QUANTITY,
  ORDER_ADDRESS_MAX_LENGTH,
  ORDER_MESSAGES,
  ORDER_NAME_MAX_LENGTH,
  ORDERS_MESSAGES,
  PAYMENT_LABELS,
  cartTotalCents,
  describeChanges,
  formatArs,
  lineTotalCents,
  normalizeArWhatsapp,
  type CreateOrderRequest,
  type CreateOrderResponse,
  type Fulfillment,
  type PaymentMethod,
  type PublicMenu,
  type PublicMenuPaymentMethod,
} from "@menucito/shared";
import { browserStorage } from "../lib/cart-store";
import { toCatalog, type CatalogProduct } from "../lib/catalog";
import { ORDER_SUBMIT_MESSAGES, orderFailureAction, refreshMenu, submitOrder } from "../lib/order-api";
import { clearToken, getOrCreateToken } from "../lib/order-attempt";
import { EMPTY_ORDER_FORM, offeredFulfillments, readOrderForm, writeOrderForm, type OrderFormValues } from "../lib/order-form";
import { useCart } from "../lib/use-cart";
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

type FormField = "name" | "phone" | "fulfillment" | "address" | "payment";

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

const FIELD_IDS: Record<FormField, string> = {
  name: "order-name",
  phone: "order-phone",
  fulfillment: "order-fulfillment",
  address: "order-address",
  payment: "order-payment",
};

function getFormErrors(
  values: OrderFormValues,
  offered: readonly Fulfillment[],
  offeredMethods: readonly PaymentMethod[],
): Partial<Record<FormField, string>> {
  const errors: Partial<Record<FormField, string>> = {};

  const trimmedName = values.name.trim();
  if (!trimmedName) {
    errors.name = ORDER_MESSAGES.nameRequired;
  } else if (trimmedName.length > ORDER_NAME_MAX_LENGTH) {
    errors.name = ORDER_MESSAGES.nameTooLong;
  }

  const trimmedPhone = values.phone.trim();
  if (!trimmedPhone) {
    errors.phone = ORDERS_MESSAGES.phoneRequired;
  } else if (!normalizeArWhatsapp(trimmedPhone)) {
    errors.phone = ORDERS_MESSAGES.phoneInvalid;
  }

  if (!values.fulfillment || !offered.includes(values.fulfillment as Fulfillment)) {
    errors.fulfillment = ORDER_MESSAGES.fulfillmentRequired;
  }

  if (values.fulfillment === "delivery") {
    const trimmedAddress = values.address.trim();
    if (!trimmedAddress) {
      errors.address = ORDER_MESSAGES.addressRequired;
    } else if (trimmedAddress.length > ORDER_ADDRESS_MAX_LENGTH) {
      errors.address = ORDER_MESSAGES.addressTooLong;
    }
  }

  if (!values.payment || !offeredMethods.includes(values.payment as PaymentMethod)) {
    errors.payment = ORDER_MESSAGES.paymentRequired;
  }

  return errors;
}

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
  // A double tap or a double Enter must send a single request (scenario 60).
  const inFlight = useRef(false);

  const [values, setValues] = useState<OrderFormValues>(EMPTY_ORDER_FORM);
  const [restored, setRestored] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<FormField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successOrder, setSuccessOrder] = useState<CreateOrderResponse | null>(null);
  const [menuRefreshed, setMenuRefreshed] = useState(false);

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
  const touch = (field: FormField) => setTouched((current) => new Set(current).add(field));

  const errors = getFormErrors(values, offered, offeredMethods);
  const visibleError = (field: FormField) => (submitted || touched.has(field) ? errors[field] : undefined);
  const describedBy = (field: FormField) => (visibleError(field) ? `${FIELD_IDS[field]}-error` : undefined);

  if (successOrder) return <OrderConfirmation slug={slug} response={successOrder} />;

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

  const subtotal = cartTotalCents(state.lines, priced);
  const shipping = values.fulfillment === "delivery" ? shippingCents : 0;
  const finalTotal = subtotal + shipping;
  const isBelowMinOrder = minOrderCents !== null && subtotal < minOrderCents;

  /** Fetches the menu without cache and adopts its rules; `null` when it could not be read. */
  const adoptFreshMenu = async (): Promise<PublicMenu | null> => {
    const menu = await refreshMenu(apiUrl, slug);
    if (menu) setLive(liveStoreFromMenu(menu));
    return menu;
  };

  /** Clears a choice the store no longer accepts, in the form and in the remembered copy. */
  const resetChoice = (field: "payment" | "fulfillment") => {
    const next = { ...values, [field]: "" };
    writeOrderForm(browserStorage(), slug, next);
    setValues(next);
    touch(field);
  };

  /** Reacts to a rejected order (scenario 61). Nothing is sent again until the diner taps once more. */
  const handleFailure = async (failure: { status: number; code: string }) => {
    const action = orderFailureAction(failure);
    switch (action.kind) {
      case "refreshMenu": {
        const menu = await adoptFreshMenu();
        if (!menu) {
          setSubmitError(ORDER_SUBMIT_MESSAGES.retry);
          return;
        }
        store.reconcile(toCatalog(menu));
        setMenuRefreshed(true);
        return;
      }
      case "paused":
        setLive((current) => ({ ...current, acceptingOrders: false }));
        return;
      case "belowMinimum":
        if (!(await adoptFreshMenu())) setSubmitError(ORDER_SUBMIT_MESSAGES.retry);
        return;
      case "refreshPaymentMethods":
        await adoptFreshMenu();
        resetChoice("payment");
        return;
      case "refreshFulfillments":
        await adoptFreshMenu();
        resetChoice("fulfillment");
        return;
      case "message":
        setSubmitError(action.message);
        return;
    }
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    if (inFlight.current) return;
    setSubmitted(true);
    setSubmitError(null);

    const currentErrors = getFormErrors(values, offered, offeredMethods);
    const firstInvalid = (Object.keys(FIELD_IDS) as FormField[]).find((field) => currentErrors[field]);
    if (firstInvalid) {
      document.getElementById(FIELD_IDS[firstInvalid])?.focus();
      return;
    }

    if (!acceptingOrders || isBelowMinOrder) return;

    inFlight.current = true;
    setSubmitting(true);
    setMenuRefreshed(false);
    const storage = browserStorage();
    const clientOrderId = getOrCreateToken(storage, slug);

    const items = state.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      choices: { ...line.choices },
    }));

    const payload: CreateOrderRequest =
      values.fulfillment === "delivery"
        ? {
            clientOrderId,
            customer: {
              name: values.name.trim(),
              phone: values.phone.trim(),
              address: values.address.trim(),
            },
            fulfillment: "delivery",
            paymentMethod: values.payment as PaymentMethod,
            expectedTotalCents: finalTotal,
            items,
          }
        : {
            clientOrderId,
            customer: {
              name: values.name.trim(),
              phone: values.phone.trim(),
              address: null,
            },
            fulfillment: "takeaway",
            paymentMethod: values.payment as PaymentMethod,
            expectedTotalCents: finalTotal,
            items,
          };

    const result = await submitOrder(apiUrl, slug, payload);

    if (result.ok) {
      inFlight.current = false;
      setSubmitting(false);
      clearToken(storage, slug);
      store.clear();
      // The confirmation counts down and then opens WhatsApp (or the customer taps the button).
      setSuccessOrder(result.data);
      return;
    }

    try {
      await handleFailure(result);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
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
            setMenuRefreshed(false);
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
          <dd>{formatArs(subtotal)}</dd>
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
            <strong>{formatArs(finalTotal)}</strong>
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
          {isBelowMinOrder && minOrderCents !== null && (
            <p class="order-min-warning">
              El pedido mínimo es {formatArs(minOrderCents)}. Te faltan {formatArs(minOrderCents - subtotal)}.
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

/** Seconds the confirmation stays on screen before opening WhatsApp on its own. */
const WHATSAPP_REDIRECT_SECONDS = 5;

/**
 * Scenario 59: the title takes the focus so the result is announced. WhatsApp opens after a short
 * countdown, so the customer can read the confirmation (and the transfer data) first; the button
 * opens it right away and the countdown can be stopped.
 */
function OrderConfirmation({ slug, response }: { slug: string; response: CreateOrderResponse }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const { order, payment, whatsappUrl } = response;
  const [secondsLeft, setSecondsLeft] = useState<number | null>(WHATSAPP_REDIRECT_SECONDS);

  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft === 0) {
      // A navigation, not a new window, so pop-up blockers do not get in the way.
      window.location.href = whatsappUrl;
      return;
    }
    const timer = setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, whatsappUrl]);

  return (
    <div class="order-confirmation" role="status">
      <span class="order-confirmation-badge" aria-hidden="true">
        ✓
      </span>
      <h2 class="order-confirmation-title" ref={titleRef} tabIndex={-1}>
        Pedido #{order.number} enviado
      </h2>
      <dl class="order-breakdown order-confirmation-summary">
        <div class="order-breakdown-row">
          <dt>Entrega</dt>
          <dd>{FULFILLMENT_LABELS[order.fulfillment]}</dd>
        </div>
        <div class="order-breakdown-total">
          <dt>Total</dt>
          <dd>
            <strong>{formatArs(order.totalCents)}</strong>
          </dd>
        </div>
      </dl>
      {order.paymentMethod === "transfer" && (
        <div class="order-transfer-box">
          {payment?.alias || payment?.holderName ? (
            <>
              <p>
                <strong>Datos para la transferencia:</strong>
              </p>
              {payment.alias && (
                <p>
                  Alias: <strong>{payment.alias}</strong>
                </p>
              )}
              {payment.holderName && (
                <p>
                  Titular: <strong>{payment.holderName}</strong>
                </p>
              )}
            </>
          ) : (
            <p>El local te pasa los datos por WhatsApp</p>
          )}
        </div>
      )}
      <p class="order-confirmation-message">Tocá el botón para mandarle el pedido al local por WhatsApp.</p>
      <a class="primary-button" href={whatsappUrl}>
        Abrir WhatsApp
      </a>
      {secondsLeft !== null && (
        // aria-live off: the parent status region would otherwise announce every tick.
        <p class="order-confirmation-countdown" aria-live="off">
          {secondsLeft > 0 ? `Te llevamos a WhatsApp en ${secondsLeft} s…` : "Abriendo WhatsApp…"}{" "}
          {secondsLeft > 0 && (
            <button type="button" class="link-button" onClick={() => setSecondsLeft(null)}>
              Quedarme acá
            </button>
          )}
        </p>
      )}
      <a class="back-link" href={`/${slug}`}>
        ← Volver al menú
      </a>
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
