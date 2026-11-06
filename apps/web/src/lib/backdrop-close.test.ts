import { describe, expect, it } from "vitest";
import { isOutsideBox } from "./backdrop-close";

describe("isOutsideBox", () => {
  const box = { left: 100, right: 300, top: 50, bottom: 250 };

  it("is false inside the dialog and on its edge", () => {
    expect(isOutsideBox(box, 200, 150)).toBe(false);
    expect(isOutsideBox(box, 100, 50)).toBe(false);
    expect(isOutsideBox(box, 300, 250)).toBe(false);
  });

  it("is true on the backdrop around it", () => {
    expect(isOutsideBox(box, 99, 150)).toBe(true);
    expect(isOutsideBox(box, 301, 150)).toBe(true);
    expect(isOutsideBox(box, 200, 49)).toBe(true);
    expect(isOutsideBox(box, 200, 251)).toBe(true);
  });
});
