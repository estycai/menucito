import { describe, expect, it } from "vitest";
import { formatElapsed } from "./elapsed";

describe("formatElapsed", () => {
  it("says 'ahora' during the first minute", () => {
    expect(formatElapsed(0)).toBe("ahora");
    expect(formatElapsed(59_999)).toBe("ahora");
  });

  it("shows minutes under an hour", () => {
    expect(formatElapsed(5 * 60_000)).toBe("5 min");
    expect(formatElapsed(59 * 60_000)).toBe("59 min");
  });

  it("shows whole hours and the remaining minutes", () => {
    expect(formatElapsed(60 * 60_000)).toBe("1 h");
    expect(formatElapsed((2 * 60 + 10) * 60_000)).toBe("2 h 10 min");
  });

  it("shows days from yesterday on", () => {
    expect(formatElapsed(24 * 60 * 60_000)).toBe("1 día");
    expect(formatElapsed(3 * 24 * 60 * 60_000)).toBe("3 días");
  });
});
