import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerCoverageRoutes } from "../../routes/coverage.js";

async function buildApp() {
  const db = { query: vi.fn() };
  const app = Fastify({ logger: false });
  await registerCoverageRoutes(app, db as never, {
    coverage: { elevationApiUrl: "https://example.invalid" },
  });
  return { app, db };
}

function expectValidationError(body: unknown, field: string) {
  expect(body).toEqual({
    error: { fieldErrors: { [field]: expect.any(Array) }, formErrors: [] },
  });
}

describe("coverage query validation", () => {
  it.each([
    ["altitudeM", "-1"],
    ["radiusKm", "0.4"],
    ["radiusKm", "51"],
    ["radials", "7"],
    ["radials", "73"],
    ["radials", "8.5"],
  ])("rejects invalid viewshed %s=%s", async (field, value) => {
    const { app, db } = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/coverage/viewshed?lat=0&lon=0&${field}=${value}`,
    });
    expect(res.statusCode).toBe(400);
    expectValidationError(res.json(), field);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("range-checks DELETE coordinates and radius before querying", async () => {
    const { app, db } = await buildApp();
    for (const [field, value] of [
      ["lat", "91"],
      ["lon", "181"],
      ["radiusKm", "nope"],
      ["radiusKm", "51"],
    ]) {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/coverage/viewshed?lat=0&lon=0&${field}=${value}`,
      });
      expect(res.statusCode).toBe(400);
      expectValidationError(res.json(), field);
    }
    expect(db.query).not.toHaveBeenCalled();
  });
});
