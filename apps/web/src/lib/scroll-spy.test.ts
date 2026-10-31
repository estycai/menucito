import { describe, expect, it } from "vitest";
import { activeSectionIndex } from "./scroll-spy";

describe("activeSectionIndex", () => {
  it("is the first section when none has crossed the line", () => {
    expect(activeSectionIndex([300, 700, 1100], 128)).toBe(0);
  });

  it("is the first section when there are no tops", () => {
    expect(activeSectionIndex([], 128)).toBe(0);
  });

  it("is the last section whose top crossed the line", () => {
    expect(activeSectionIndex([-600, 90, 500], 128)).toBe(1);
    expect(activeSectionIndex([-1200, -700, -100], 128)).toBe(2);
  });

  it("counts a top exactly on the line as crossed", () => {
    expect(activeSectionIndex([-400, 128, 600], 128)).toBe(1);
  });

  it("does not depend on sections below the line", () => {
    expect(activeSectionIndex([0, 50, 5000], 128)).toBe(1);
  });
});
