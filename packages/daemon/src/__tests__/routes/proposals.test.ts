import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerProposalRoutes } from "../../routes/proposals.js";

const PROPOSAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function expectValidationError(body: unknown) {
  expect(body).toEqual({
    error: { fieldErrors: {}, formErrors: expect.any(Array) },
  });
}

describe("proposal body validation", () => {
  for (const body of [[], null, "proposal", 42]) {
    it(`rejects POST body ${JSON.stringify(body)} before querying`, async () => {
      const db = { query: vi.fn() };
      const app = Fastify({ logger: false });
      await registerProposalRoutes(app, db as never);
      const res = await app.inject({
        method: "POST",
        url: "/api/proposals",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(body),
      });
      expect(res.statusCode).toBe(400);
      expectValidationError(res.json());
      expect(db.query).not.toHaveBeenCalled();
    });

    it(`rejects PATCH body ${JSON.stringify(body)} before querying`, async () => {
      const db = { query: vi.fn() };
      const app = Fastify({ logger: false });
      await registerProposalRoutes(app, db as never);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/proposals/${PROPOSAL_ID}`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(body),
      });
      expect(res.statusCode).toBe(400);
      expectValidationError(res.json());
      expect(db.query).not.toHaveBeenCalled();
    });
  }
});
