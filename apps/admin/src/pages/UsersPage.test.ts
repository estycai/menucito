import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/restaurant";
import { actionFailure } from "./UsersPage";

describe("actionFailure (13 scenario 33)", () => {
  it("tells the owner to deactivate a member with orders instead of deleting it", () => {
    expect(actionFailure(new ApiError(409, "MEMBER_HAS_HISTORY", "x"), "eliminar")).toBe(
      "Tiene pedidos asignados. Desactivalo en lugar de eliminarlo.",
    );
  });

  it("keeps the specific copy of the other known codes", () => {
    expect(actionFailure(new ApiError(404, "MEMBER_NOT_FOUND", "x"), "eliminar")).toContain("Ya no existe");
    expect(actionFailure(new ApiError(403, "OWNER_IMMUTABLE", "x"), "desactivar")).toBe("El dueño no se puede modificar.");
  });
});
