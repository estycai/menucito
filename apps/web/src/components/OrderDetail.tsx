import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  ADDRESS_LABEL_TEXT,
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
  type DeliveryMode,
  type Fulfillment,
  type HoursSlot,
  type LatLng,
  type OrderDelivery,
  type PaymentMethod,
  type PublicMenu,
  type PublicMenuPaymentMethod,
} from "@menucito/shared";
import { browserStorage } from "../lib/cart-store";
import { toCatalog, type CatalogProduct } from "../lib/catalog";
import { addressLines, deliveryPricing, type QuoteState } from "../lib/delivery-address";
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
import { useDeliveryQuote } from "../lib/use-delivery-quote";
import { useOrderSubmit } from "../lib/use-order-submit";
import { orderHoursNotice } from "../lib/store-hours";
import { AddressDialog } from "./AddressDialog";
import { CoverageDialog } from "./CoverageDialog";
import { OrderConfirmation } from "./OrderConfirmation";
import { Stepper } from "./Stepper";

interface OrderDetailProps {
  slug: string;
  delivery: boolean;
  takeaway: boolean;
  products: CatalogProduct[];
  acceptingOrders: boolean;
  hours: HoursSlot[];
  acceptOrdersOutsideHours: boolean;
  minOrderCents: number | null;
  shippingCents: number;
  deliveryMode: DeliveryMode;
  location: LatLng | null;
  paymentMethods: PublicMenuPaymentMethod[];
  apiUrl: string;
}

/** The store rules the page works with: the server-rendered ones, replaced by a fresh menu after a conflict. */
interface LiveStore {
  delivery: boolean;
  takeaway: boolean;
  products: CatalogProduct[];
  acceptingOrders: boolean;
  hours: HoursSlot[];
  acceptOrdersOutsideHours: boolean;
  minOrderCents: number | null;
  shippingCents: number;
  deliveryMode: DeliveryMode;
  location: LatLng | null;
  paymentMethods: PublicMenuPaymentMethod[];
}

function liveStoreFromMenu(menu: PublicMenu): LiveStore {
  const { restaurant } = menu;
  return {
    delivery: restaurant.delivery,
    takeaway: restaurant.takeaway,
    products: toCatalog(menu),
    acceptingOrders: restaurant.acceptingOrders,
    hours: restaurant.hours,
    acceptOrdersOutsideHours: restaurant.acceptOrdersOutsideHours,
    minOrderCents: restaurant.minOrderCents,
    shippingCents: restaurant.shippingCents,
    deliveryMode: restaurant.deliveryMode,
    location: restaurant.location,
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
  const {
    delivery,
    takeaway,
    products,
    acceptingOrders,
    hours,
    acceptOrdersOutsideHours,
    minOrderCents,
    shippingCents,
    deliveryMode,
    location,
    paymentMethods,
  } = live;
  // `zones`: the diner picks a geocoded address and the API quotes it; `flat`: a typed address.
  const storeLocation = deliveryMode === "zones" ? location : null;
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
  // Never persisted: the diner chooses the address on every visit.
  const [deliveryAddress, setDeliveryAddress] = useState<OrderDelivery | null>(null);
  const [addressOpen, setAddressOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  // The clock the opening hours are checked against, refreshed so an open page follows the hours.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

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
    onOutOfCoverage: () => {
      setCoverageOpen(true);
      retryQuote();
    },
  });
  const { submitting, submitError, successOrder, menuRefreshed } = orderSubmit;

  const subtotalCents = cartTotalCents(state.lines, priced);
  const zonesDelivery = storeLocation !== null && values.fulfillment === "delivery";
  const { quote, retry: retryQuote } = useDeliveryQuote({
    apiUrl,
    slug,
    point: deliveryAddress,
    subtotalCents,
    enabled: zonesDelivery,
  });

  const errors = getFormErrors(values, offered, offeredMethods, storeLocation ? { address: deliveryAddress } : undefined);
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

  const pricing = deliveryPricing(storeLocation !== null, quote, { shippingCents, minOrderCents });
  const totals = orderTotals({
    subtotalCents,
    shippingCents: pricing.shippingCents,
    // Until a fulfillment is picked, the total is shown without shipping.
    fulfillment: values.fulfillment === "delivery" ? "delivery" : "takeaway",
  });
  // A zone's minimum only applies to deliveries.
  const effectiveMinCents = values.fulfillment === "delivery" ? pricing.minOrderCents : minOrderCents;
  const shortfall = minOrderShortfallCents(totals.subtotalCents, effectiveMinCents);
  const isBelowMinOrder = shortfall !== null;
  // Out of coverage the button only looks disabled: tapping it explains why (and offers a way out).
  const outOfCoverage = zonesDelivery && pricing.covered === false;
  const quoting = zonesDelivery && deliveryAddress !== null && quote.status === "loading";
  // Pausing takes priority: while paused, the hours notice is not shown.
  const hoursNotice = orderHoursNotice({ slots: hours, acceptOrdersOutsideHours }, now, values.fulfillment);
  const closed = acceptingOrders && !hoursNotice.canOrder;

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

    if (outOfCoverage) {
      setCoverageOpen(true);
      return;
    }
    if (zonesDelivery && quote.status === "error") {
      retryQuote();
      return;
    }
    if (!acceptingOrders || closed || isBelowMinOrder || quoting) return;

    const geocoded = zonesDelivery ? deliveryAddress : null;
    void orderSubmit.send((clientOrderId) => buildOrderRequest(values, state.lines, clientOrderId, totals.totalCents, geocoded));
  };

  return (
    <div class="order" ref={regionRef} tabIndex={-1}>
      {!acceptingOrders && (
        <aside class="pause-banner" role="status">
          Este local no está recibiendo pedidos por ahora. <a href={`/${slug}`}>Podés ver el menú</a>.
        </aside>
      )}
      {acceptingOrders && hoursNotice.text && (
        <aside class="pause-banner" role="status">
          {hoursNotice.text}
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
          (zonesDelivery && pricing.covered !== true ? (
            <div class="order-breakdown-row">
              <dt>Envío</dt>
              <dd>{pendingShippingText(deliveryAddress !== null, quote)}</dd>
            </div>
          ) : pricing.shippingCents > 0 ? (
            <div class="order-breakdown-row">
              <dt>Envío</dt>
              <dd>{formatArs(pricing.shippingCents)}</dd>
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

        {values.fulfillment === "delivery" && storeLocation && (
          <DeliveryAddressField
            address={deliveryAddress}
            quote={quote}
            error={visibleError("address")}
            onEdit={() => setAddressOpen(true)}
            onRetryQuote={retryQuote}
          />
        )}

        {values.fulfillment === "delivery" && !storeLocation && (
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
          {shortfall !== null && effectiveMinCents !== null && !outOfCoverage && (
            <p class="order-min-warning">
              El pedido mínimo es {formatArs(effectiveMinCents)}. Te faltan {formatArs(shortfall)}.
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
          disabled={submitting || !acceptingOrders || closed || quoting || (isBelowMinOrder && !outOfCoverage)}
          aria-disabled={outOfCoverage ? "true" : undefined}
          aria-describedby={outOfCoverage ? COVERAGE_HINT_ID : undefined}
        >
          {submitting
            ? "Enviando…"
            : !acceptingOrders
              ? "Recepción pausada"
              : closed
                ? "Local cerrado"
                : quoting
                ? "Calculando envío…"
                : "Enviar pedido"}
        </button>
        {outOfCoverage && (
          <p class="visually-hidden" id={COVERAGE_HINT_ID}>
            Tu dirección está fuera de la zona de entrega
          </p>
        )}
        <p class="order-note">Al enviar, se abrirá WhatsApp con el detalle de tu pedido para coordinar con el local.</p>
      </form>

      {addressOpen && storeLocation && (
        <AddressDialog
          apiUrl={apiUrl}
          slug={slug}
          origin={storeLocation}
          initial={deliveryAddress}
          onClose={() => setAddressOpen(false)}
          onConfirm={(address) => {
            setDeliveryAddress(address);
            // Same pin, new quote: the store may have changed its zones since the last one.
            retryQuote();
            touch("address");
            orderSubmit.clearError();
          }}
        />
      )}

      {coverageOpen && (
        <CoverageDialog
          canTakeaway={offered.includes("takeaway")}
          onClose={() => setCoverageOpen(false)}
          onTakeaway={() => {
            change({ fulfillment: "takeaway" });
            touch("fulfillment");
            orderSubmit.clearError();
          }}
          onChangeAddress={() => setAddressOpen(true)}
        />
      )}
    </div>
  );
}

const COVERAGE_HINT_ID = "order-coverage-hint";

/** The shipping row while the zone price is unknown. */
function pendingShippingText(hasAddress: boolean, quote: QuoteState): string {
  if (!hasAddress) return "Según tu dirección";
  if (quote.status === "ready") return "Sin cobertura";
  if (quote.status === "error") return "No disponible";
  return "Calculando…";
}

interface DeliveryAddressFieldProps {
  address: OrderDelivery | null;
  quote: QuoteState;
  error: string | undefined;
  onEdit: () => void;
  onRetryQuote: () => void;
}

/** The address card of stores in `zones` mode: empty with "Agregar", or the address and its coverage. */
function DeliveryAddressField({ address, quote, error, onEdit, onRetryQuote }: DeliveryAddressFieldProps) {
  const errorId = `${FIELD_IDS.address}-error`;
  const lines = address ? addressLines(address) : null;
  // The diner's tag ("Casa", "Trabajo", "Otra") reads before the locality.
  const secondary = [address?.label ? ADDRESS_LABEL_TEXT[address.label] : "", lines?.secondary ?? ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <div class="field">
      <div class={`address-card${error ? " address-card-invalid" : ""}`}>
        {lines ? (
          <span class="address-card-text">
            <strong class="address-card-main">{lines.main}</strong>
            {secondary && <span class="address-card-secondary">{secondary}</span>}
            {address?.unit && <span class="address-card-secondary">{address.unit}</span>}
            <CoverageBadge quote={quote} onRetry={onRetryQuote} />
          </span>
        ) : (
          <span class="address-card-text">
            <strong class="address-card-main">Dirección de entrega</strong>
            <span class="address-card-secondary">Agregá dónde recibir tu pedido</span>
          </span>
        )}
        <button
          type="button"
          class="text-button"
          id={FIELD_IDS.address}
          aria-label={address ? "Cambiar la dirección de entrega" : "Agregar la dirección de entrega"}
          aria-describedby={error ? errorId : undefined}
          onClick={onEdit}
        >
          {address ? "Cambiar" : "Agregar"}
        </button>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function CoverageBadge({ quote, onRetry }: { quote: QuoteState; onRetry: () => void }) {
  if (quote.status === "ready") {
    return quote.quote.covered ? (
      <span class="coverage-badge coverage-badge-ok">
        <span aria-hidden="true">●</span> Llega a tu dirección
      </span>
    ) : (
      <span class="coverage-badge coverage-badge-out">
        <span aria-hidden="true">●</span> Sin cobertura
      </span>
    );
  }
  if (quote.status === "error") {
    return (
      <span class="coverage-badge coverage-badge-out" role="alert">
        No pudimos calcular el envío.{" "}
        <button type="button" class="link-button" onClick={onRetry}>
          Reintentar
        </button>
      </span>
    );
  }
  return (
    <span class="coverage-badge" role="status">
      <span class="spinner" aria-hidden="true" /> Calculando envío…
    </span>
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
