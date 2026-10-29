import { describe, expect, it } from "vitest";
import { moveId } from "./order";

describe("moveId", () => {
  it("moves an item up and down", () => {
    expect(moveId(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("leaves the order unchanged at the edges", () => {
    expect(moveId(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveId(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(moveId(["a"], 5, -1)).toEqual(["a"]);
  });

  it("does not mutate the input", () => {
    const ids = ["a", "b"];
    moveId(ids, 0, 1);
    expect(ids).toEqual(["a", "b"]);
  });
});
