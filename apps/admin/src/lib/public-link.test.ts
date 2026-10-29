import { describe, expect, it } from "vitest";
import { publicMenuHref } from "./public-link";

describe("publicMenuHref", () => {
  it.each(["localhost:4321", "127.0.0.1:4321", "localhost"])("uses http for the local host %s", (base) => {
    expect(publicMenuHref(base, "mi-local")).toBe(`http://${base}/mi-local`);
  });

  it.each(["menucito.com", "app.menucito.com", "localhost.example.com"])("uses https for %s", (base) => {
    expect(publicMenuHref(base, "mi-local")).toBe(`https://${base}/mi-local`);
  });
});
