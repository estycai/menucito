import { describe, expect, it } from "vitest";
import { DELIVERY_MESSAGES, distanceMeters, type DeliveryZone } from "@menucito/shared";
import {
  ZONE_COLORS,
  ZONE_FORM_MESSAGES,
  checkZoneDraft,
  checkZoneDrafts,
  circlePath,
  draftFromZone,
  moveItem,
  newZoneDraft,
  squareAround,
  zonePriceLabel,
  type ZoneDraft,
} from "./zone-form";

const STORE = { lat: -34.6037, lng: -58.3816 };

const ringZone = {
  id: "z1",
  name: "Anillo",
  color: "#15803D",
  active: false,
  sort: 1,
  shape: "ring",
  innerRadiusM: 2000,
  radiusM: 5000,
  pricing: "per_km",
  baseCents: 30000,
  perKmCents: 10050,
  minShippingCents: null,
  maxShippingCents: 200000,
  minOrderCents: 1_000_000,
  freeFromCents: null,
} as DeliveryZone;

const fixedDraft = (overrides: Partial<ZoneDraft> = {}): ZoneDraft => ({ ...newZoneDraft([], "k1"), price: "1.500", ...overrides });

describe("draftFromZone", () => {
  it("keeps the geometry and shows money as the fields do", () => {
    expect(draftFromZone(ringZone)).toMatchObject({
      key: "z1",
      id: "z1",
      shape: "ring",
      innerRadiusM: 2000,
      radiusM: 5000,
      polygon: [],
      pricing: "per_km",
      price: "",
      base: "300",
      perKm: "100,50",
      minShipping: "",
      maxShipping: "2.000",
      minOrder: "10.000",
      freeFrom: "",
    });
  });
});

describe("newZoneDraft", () => {
  it("starts with a radius around the store", () => {
    expect(newZoneDraft([], "k")).toMatchObject({ name: "Zona 1", color: ZONE_COLORS[0], shape: "radius", radiusM: 2000, active: true });
  });

  it("adds a ring around the largest zone with the next color", () => {
    const next = newZoneDraft([draftFromZone(ringZone)], "k");
    expect(next).toMatchObject({ name: "Zona 2", color: ZONE_COLORS[1], shape: "ring", innerRadiusM: 5000, radiusM: 7000 });
  });
});

describe("zonePriceLabel", () => {
  it.each([
    [{ pricing: "fixed", price: "1500" }, "$1.500"],
    [{ pricing: "fixed", price: "0" }, "Gratis"],
    [{ pricing: "fixed", price: "" }, "Sin precio"],
    [{ pricing: "fixed", price: "abc" }, "Sin precio"],
    [{ pricing: "per_km", price: "" }, "Por km"],
  ] as const)("%j -> %s", (draft, label) => {
    expect(zonePriceLabel(draft)).toBe(label);
  });
});

describe("moveItem", () => {
  it("swaps with the neighbour and ignores moves past the ends", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});

describe("checkZoneDraft", () => {
  it("maps a fixed radius draft to the API input", () => {
    const check = checkZoneDraft(fixedDraft({ minOrder: "5.000" }));
    expect(check.input).toEqual({
      name: "Zona 1",
      color: ZONE_COLORS[0],
      active: true,
      shape: "radius",
      radiusM: 2000,
      pricing: "fixed",
      priceCents: 150000,
      minOrderCents: 500000,
      freeFromCents: null,
    });
  });

  it("round-trips a saved zone with its id", () => {
    const check = checkZoneDraft(draftFromZone(ringZone));
    // `toEqual` treats the undefined `sort` as missing: the API sets it from the list order.
    expect(check.input).toEqual({ ...ringZone, sort: undefined });
  });

  it("sends only the chosen shape and pricing", () => {
    const polygon = squareAround(STORE, 1000);
    const check = checkZoneDraft({ ...draftFromZone(ringZone), shape: "polygon", polygon, pricing: "fixed", price: "0" });
    expect(check.input).toMatchObject({ shape: "polygon", polygon, pricing: "fixed", priceCents: 0 });
    expect(check.input).not.toHaveProperty("radiusM");
    expect(check.input).not.toHaveProperty("baseCents");
  });

  it("requires the price fields of the chosen pricing", () => {
    expect(checkZoneDraft(fixedDraft({ price: "" })).errors).toEqual({ price: ZONE_FORM_MESSAGES.priceRequired });
    expect(checkZoneDraft(fixedDraft({ pricing: "per_km" })).errors).toEqual({
      base: ZONE_FORM_MESSAGES.baseRequired,
      perKm: ZONE_FORM_MESSAGES.perKmRequired,
    });
  });

  it("reports the shared schema errors on their fields", () => {
    const errors = checkZoneDraft(fixedDraft({ name: " ", shape: "polygon", polygon: [[-34.6, -58.4]], freeFrom: "x" })).errors;
    expect(errors).toEqual({
      name: DELIVERY_MESSAGES.zoneNameRequired,
      polygon: DELIVERY_MESSAGES.polygonTooFew,
      freeFrom: DELIVERY_MESSAGES.moneyInvalid,
    });
  });

  it("rejects a ring whose inner radius is not smaller than the outer one", () => {
    const errors = checkZoneDraft({ ...draftFromZone(ringZone), innerRadiusM: 6000 }).errors;
    expect(errors).toEqual({ innerRadiusM: DELIVERY_MESSAGES.ringInvalid });
  });
});

describe("checkZoneDrafts", () => {
  it("keys errors by draft and returns inputs only when every zone is valid", () => {
    const ok = fixedDraft();
    const bad = fixedDraft({ key: "k2", price: "" });
    expect(checkZoneDrafts([ok, bad])).toEqual({ inputs: null, errors: { k2: { price: ZONE_FORM_MESSAGES.priceRequired } } });
    expect(checkZoneDrafts([ok]).inputs).toHaveLength(1);
  });
});

describe("geometry helpers", () => {
  it("squareAround centers a square of the given size on the point", () => {
    const square = squareAround(STORE, 2000);
    expect(square).toHaveLength(4);
    const [nw, ne] = square;
    expect(distanceMeters({ lat: nw![0], lng: nw![1] }, { lat: ne![0], lng: ne![1] })).toBeCloseTo(2000, -1);
  });

  it("circlePath puts every point at the radius, winding as asked", () => {
    const path = circlePath(STORE, 3000, true, 8);
    expect(path).toHaveLength(8);
    for (const point of path) expect(distanceMeters(STORE, point)).toBeCloseTo(3000, -1);
    // Starting north, clockwise heads east (+lng) and counterclockwise west.
    expect(circlePath(STORE, 3000, true, 8)[1]!.lng).toBeGreaterThan(STORE.lng);
    expect(circlePath(STORE, 3000, false, 8)[1]!.lng).toBeLessThan(STORE.lng);
  });
});
