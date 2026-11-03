import { describe, expect, it } from "vitest";
import { ApiError } from "./restaurant";
import { ORDERS_UI_MESSAGES } from "./orders-messages";
import { exportErrorMessage } from "./use-orders-export";

describe("exportErrorMessage", () => {
  it("asks to narrow the dates only for the too-many-orders code", () => {
    expect(exportErrorMessage(new ApiError(422, "EXPORT_TOO_LARGE", "x"))).toBe(ORDERS_UI_MESSAGES.exportTooLarge);
  });

  it("uses the generic copy for other 422s, server errors and network failures", () => {
    expect(exportErrorMessage(new ApiError(422, "VALIDATION_ERROR", "x"))).toBe(ORDERS_UI_MESSAGES.exportFailed);
    expect(exportErrorMessage(new ApiError(500, "INTERNAL", "x"))).toBe(ORDERS_UI_MESSAGES.exportFailed);
    expect(exportErrorMessage(new TypeError("Failed to fetch"))).toBe(ORDERS_UI_MESSAGES.exportFailed);
  });
});
