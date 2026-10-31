import { describe, expect, it } from "vitest";
import { PRODUCT_GONE_STATE, PRODUCT_SAVED_STATE, createdProductState, menuNotice } from "./menu-notice";

describe("menuNotice", () => {
  it("recognizes the states the editor sets", () => {
    expect(menuNotice(PRODUCT_SAVED_STATE)).toBe("saved");
    expect(menuNotice(PRODUCT_GONE_STATE)).toBe("gone");
  });

  it("ignores any other state", () => {
    expect(menuNotice(null)).toBeNull();
    expect(menuNotice(undefined)).toBeNull();
    expect(menuNotice("saved")).toBeNull();
    expect(menuNotice({ notice: "other" })).toBeNull();
    expect(menuNotice({})).toBeNull();
  });
});

describe("createdProductState", () => {
  const bacon = { name: "Bacon", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 150_000 };

  it("reads the photo flag and the carried ingredients", () => {
    expect(createdProductState({ photoError: true, ingredients: [bacon] })).toEqual({ photoError: true, ingredients: [bacon] });
    expect(createdProductState({ ingredients: [] })).toEqual({ photoError: false, ingredients: [] });
  });

  it("treats missing, foreign or malformed state as nothing", () => {
    const nothing = { photoError: false, ingredients: null };
    expect(createdProductState(null)).toEqual(nothing);
    expect(createdProductState("x")).toEqual(nothing);
    expect(createdProductState({ notice: "saved" })).toEqual(nothing);
    expect(createdProductState({ photoError: "yes", ingredients: [{ name: 1 }] })).toEqual(nothing);
  });
});
