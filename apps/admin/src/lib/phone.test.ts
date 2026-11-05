import { normalizeMemberPhone } from "@menucito/shared";
import { describe, expect, it } from "vitest";
import { formatPhone, splitPhone } from "./phone";

describe("splitPhone", () => {
  it("defaults to +54 and an empty number when there is no phone", () => {
    expect(splitPhone(null)).toEqual({ prefix: "+54", number: "" });
    expect(splitPhone("")).toEqual({ prefix: "+54", number: "" });
  });

  it("drops the mobile 9 of an Argentine phone", () => {
    expect(splitPhone("+5491112345678")).toEqual({ prefix: "+54", number: "1112345678" });
  });

  it("round-trips through the API normalization", () => {
    const { prefix, number } = splitPhone("+5491112345678");
    expect(normalizeMemberPhone(prefix, number)).toBe("+5491112345678");
    const uy = splitPhone("+59899123456");
    expect(uy).toEqual({ prefix: "+598", number: "99123456" });
    expect(normalizeMemberPhone(uy.prefix, uy.number)).toBe("+59899123456");
  });

  it("picks the longest matching prefix", () => {
    expect(splitPhone("+5511987654321").prefix).toBe("+55");
    expect(splitPhone("+59171234567").prefix).toBe("+591");
  });

  it("formats prefix and number", () => {
    expect(formatPhone("+5491112345678")).toBe("+54 1112345678");
    expect(formatPhone(null)).toBe("");
  });
});
