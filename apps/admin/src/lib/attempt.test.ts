import { describe, expect, it } from "vitest";
import { attempt } from "./attempt";

describe("attempt", () => {
  it("is true when the task resolves", async () => {
    expect(await attempt(async () => "ok")).toBe(true);
  });

  it("is false, without throwing, when the task rejects", async () => {
    expect(await attempt(() => Promise.reject(new Error("boom")))).toBe(false);
  });

  it("is false when the task throws synchronously", async () => {
    expect(
      await attempt(() => {
        throw new Error("boom");
      }),
    ).toBe(false);
  });
});
