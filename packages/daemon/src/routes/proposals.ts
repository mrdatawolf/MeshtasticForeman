import { z } from "zod";

import { deviceIdSchema, sendValidationError } from "./schemas.js";

import type { PGlite } from "@electric-sql/pglite";
import type { CoverageProposal } from "@foreman/shared";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// DB row → API response mapping
// ---------------------------------------------------------------------------

interface ProposalRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  altitude_m: number;
  modem_preset: number;
  notes: string | null;
  visible: boolean;
  created_at: string;
}

const proposalBodySchema = z.object({
  name: z.string().trim().min(1),
  lat: z.coerce.number().finite().min(-90).max(90),
  lon: z.coerce.number().finite().min(-180).max(180),
  altitudeM: z.coerce.number().finite().default(2),
  modemPreset: z.coerce.number().finite().min(0).max(8).default(0),
  notes: z
    .string()
    .trim()
    .transform((value) => value || null)
    .nullable()
    .optional(),
  visible: z.boolean().optional(),
});
const proposalPatchBodySchema = proposalBodySchema.partial();
const proposalParamsSchema = z.object({ id: deviceIdSchema });

function rowToProposal(row: ProposalRow): CoverageProposal {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    altitudeM: row.altitude_m,
    modemPreset: row.modem_preset,
    notes: row.notes,
    visible: row.visible,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerProposalRoutes(app: FastifyInstance, db: PGlite) {
  // GET /api/proposals — list all proposals ordered by creation time
  app.get("/api/proposals", async (_req, _reply) => {
    const { rows } = await db.query<ProposalRow>(
      "SELECT * FROM coverage_proposals ORDER BY created_at ASC",
    );
    return rows.map(rowToProposal);
  });

  // POST /api/proposals — create a new proposal
  app.post("/api/proposals", async (req, reply) => {
    const result = proposalBodySchema.safeParse(req.body);
    if (!result.success) return sendValidationError(reply, result.error);
    const { name, lat, lon, altitudeM, modemPreset, notes = null } = result.data;

    const { rows } = await db.query<ProposalRow>(
      `INSERT INTO coverage_proposals (name, lat, lon, altitude_m, modem_preset, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, lat, lon, altitudeM, modemPreset, notes],
    );

    // Return the created proposal (Fastify sends 200; use consistent return-value pattern)
    return rowToProposal(rows[0]);
  });

  // PATCH /api/proposals/:id — partial update
  app.patch("/api/proposals/:id", async (req, reply) => {
    const paramsResult = proposalParamsSchema.safeParse(req.params);
    if (!paramsResult.success) return sendValidationError(reply, paramsResult.error);
    const bodyResult = proposalPatchBodySchema.safeParse(req.body);
    if (!bodyResult.success) return sendValidationError(reply, bodyResult.error);
    const { id } = paramsResult.data;
    const body = bodyResult.data;

    // Fetch existing row first
    const existing = await db.query<ProposalRow>("SELECT * FROM coverage_proposals WHERE id = $1", [
      id,
    ]);
    if (existing.rows.length === 0) return reply.status(404).send({ error: "proposal not found" });

    const current = existing.rows[0];

    const name = body.name ?? current.name;
    const lat = body.lat ?? current.lat;
    const lon = body.lon ?? current.lon;
    const altitudeM = body.altitudeM ?? current.altitude_m;
    const modemPreset = body.modemPreset !== undefined ? body.modemPreset : current.modem_preset;
    const notes = body.notes !== undefined ? body.notes : current.notes;
    const visible = body.visible ?? current.visible;

    const { rows } = await db.query<ProposalRow>(
      `UPDATE coverage_proposals
       SET name=$2, lat=$3, lon=$4, altitude_m=$5, modem_preset=$6, notes=$7, visible=$8
       WHERE id=$1
       RETURNING *`,
      [id, name, lat, lon, altitudeM, modemPreset, notes, visible],
    );

    return rowToProposal(rows[0]);
  });

  // DELETE /api/proposals/:id — remove a proposal
  app.delete("/api/proposals/:id", async (req, reply) => {
    const result = proposalParamsSchema.safeParse(req.params);
    if (!result.success) return sendValidationError(reply, result.error);
    const { id } = result.data;

    const { rows } = await db.query<ProposalRow>(
      "DELETE FROM coverage_proposals WHERE id = $1 RETURNING id",
      [id],
    );

    if (rows.length === 0) return reply.status(404).send({ error: "proposal not found" });

    return reply.status(204).send();
  });
}
