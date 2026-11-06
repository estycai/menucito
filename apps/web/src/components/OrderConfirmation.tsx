import { useEffect, useRef, useState } from "preact/hooks";
import { FULFILLMENT_LABELS, formatArs, type CreateOrderResponse } from "@menucito/shared";

/** Seconds the confirmation stays on screen before opening WhatsApp on its own. */
const WHATSAPP_REDIRECT_SECONDS = 5;

/** If the page is still visible this long after the redirect, WhatsApp did not open. */
const NAVIGATION_STALL_MS = 2000;

/**
 * Scenario 59: the title takes the focus so the result is announced. WhatsApp opens after a short
 * countdown, so the customer can read the confirmation (and the transfer data) first; the button
 * opens it right away and the countdown can be stopped. "Volver al menú" is the page's own link,
 * above the island, so the confirmation does not repeat it.
 */
export function OrderConfirmation({ response }: { response: CreateOrderResponse }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const { order, payment, whatsappUrl } = response;
  const [secondsLeft, setSecondsLeft] = useState<number | null>(WHATSAPP_REDIRECT_SECONDS);
  const [navigationStalled, setNavigationStalled] = useState(false);

  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft === 0) {
      // A navigation, not a new window, so pop-up blockers do not get in the way.
      window.location.href = whatsappUrl;
      // Blocked or ignored navigations leave the page on screen: point the customer to the button.
      const stall = setTimeout(() => {
        if (document.visibilityState === "visible") setNavigationStalled(true);
      }, NAVIGATION_STALL_MS);
      return () => clearTimeout(stall);
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
        <div class="order-breakdown-row">
          <dt>Productos</dt>
          <dd>{formatArs(order.subtotalCents)}</dd>
        </div>
        {order.shippingCents > 0 && (
          <div class="order-breakdown-row">
            <dt>Envío</dt>
            <dd>{formatArs(order.shippingCents)}</dd>
          </div>
        )}
        {order.tipCents > 0 && (
          <div class="order-breakdown-row">
            <dt>Propina</dt>
            <dd>{formatArs(order.tipCents)}</dd>
          </div>
        )}
        <div class="order-breakdown-total">
          <dt>Total</dt>
          <dd>
            <strong>{formatArs(order.totalCents)}</strong>
          </dd>
        </div>
      </dl>
      {(order.paymentMethod === "transfer" || order.paymentMethod === "split") && (
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
          {countdownText(secondsLeft, navigationStalled)}{" "}
          {secondsLeft > 0 && (
            <button type="button" class="link-button" onClick={() => setSecondsLeft(null)}>
              Quedarme acá
            </button>
          )}
        </p>
      )}
    </div>
  );
}

function countdownText(secondsLeft: number, navigationStalled: boolean): string {
  if (secondsLeft > 0) return `Te llevamos a WhatsApp en ${secondsLeft} s…`;
  return navigationStalled ? "Si WhatsApp no se abrió, tocá el botón." : "Abriendo WhatsApp…";
}
