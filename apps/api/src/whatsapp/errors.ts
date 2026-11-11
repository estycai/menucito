import { WhatsappApiError } from "./graph";

/**
 * Spanish message for a failed notice. Only the codes the store may act on are spelled out; the rest
 * keep Meta's code so support can look it up.
 */
const KNOWN_MESSAGES: Readonly<Record<number, string>> = {
  100: "Meta rechazó el aviso: revisá el número del cliente.",
  190: "El token de WhatsApp venció. Volvé a conectar el número.",
  131026: "El cliente no puede recibir mensajes de WhatsApp en ese número.",
  131047: "La ventana de 24 horas se cerró: mandá el aviso a mano.",
  131056: "Meta limitó los avisos de este número. Probá más tarde.",
  132000: "El aviso no coincide con la plantilla de Meta.",
};

export function whatsappErrorMessageForCode(metaCode: number | null): string {
  if (metaCode !== null && KNOWN_MESSAGES[metaCode]) return KNOWN_MESSAGES[metaCode];
  if (metaCode !== null) return `No se pudo enviar el aviso (código ${metaCode})`;
  return "No se pudo enviar el aviso";
}

export function whatsappErrorMessage(error: unknown): string {
  return whatsappErrorMessageForCode(error instanceof WhatsappApiError ? error.metaCode : null);
}

/** Error code stored with the notice; Meta's when there is one. */
export function whatsappErrorCode(error: unknown): string {
  return error instanceof WhatsappApiError && error.metaCode !== null ? String(error.metaCode) : "UNKNOWN";
}

/** Whether the failure means the local's token is no longer valid. */
export function isExpiredToken(error: unknown): boolean {
  return error instanceof WhatsappApiError && error.metaCode === 190;
}
