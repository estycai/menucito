import { describe, expect, it } from "vitest";
import { WHATSAPP_WINDOW_MS, whatsappManualUrl, whatsappWindowOpen } from "./whatsapp";

const NOW = 1_800_000_000_000;

describe("whatsappWindowOpen", () => {
  it("is open when the customer wrote less than 24 hours ago", () => {
    expect(whatsappWindowOpen(NOW - 1, NOW)).toBe(true);
    expect(whatsappWindowOpen(NOW - WHATSAPP_WINDOW_MS + 1, NOW)).toBe(true);
  });

  it("is closed from exactly 24 hours and when there is no inbound message", () => {
    expect(whatsappWindowOpen(NOW - WHATSAPP_WINDOW_MS, NOW)).toBe(false);
    expect(whatsappWindowOpen(NOW - WHATSAPP_WINDOW_MS - 1, NOW)).toBe(false);
    expect(whatsappWindowOpen(null, NOW)).toBe(false);
    expect(whatsappWindowOpen(undefined, NOW)).toBe(false);
  });
});

describe("whatsappManualUrl", () => {
  it("keeps only the digits of the phone and encodes the text", () => {
    expect(whatsappManualUrl("+54 9 11 5555-1234", "Hola Juan, ya está listo")).toBe(
      "https://wa.me/5491155551234?text=Hola%20Juan%2C%20ya%20est%C3%A1%20listo",
    );
  });
});
