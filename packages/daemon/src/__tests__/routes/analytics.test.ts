import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAnalyticsFixture,
  DEVICE_A,
  DEVICE_B,
  MISSING_DEVICE,
  seedDevice,
  seedMessage,
  seedNode,
  seedPacket,
  seedPosition,
  truncateIso,
} from "./analytics-fixtures.js";

import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

function expectValidationError(body: unknown, field: string) {
  expect(body).toEqual({
    error: {
      fieldErrors: { [field]: expect.any(Array) },
      formErrors: [],
    },
  });
}

describe("analytics REST endpoints", () => {
  let app: FastifyInstance;
  let db: PGlite;
  let recent: string;
  let recentEarlier: string;
  let old: string;

  beforeAll(async () => {
    ({ app, db } = await createAnalyticsFixture());
    const seedBucket = new Date(Date.now() - 10 * 60_000);
    seedBucket.setUTCSeconds(0, 0);
    seedBucket.setUTCMinutes(Math.floor(seedBucket.getUTCMinutes() / 5) * 5);
    recentEarlier = new Date(seedBucket.getTime() + 60_000).toISOString();
    recent = new Date(seedBucket.getTime() + 2 * 60_000).toISOString();
    old = new Date(Date.now() - 40 * 86_400_000).toISOString();

    await seedDevice(db, DEVICE_A, "Alpha Gateway");
    await seedDevice(db, DEVICE_B, "Beta Gateway");
    await db.query("INSERT INTO hw_models(model_num, name) VALUES (10, 'TBEAM')");
    await db.query(
      "INSERT INTO channels(device_id, idx, name, role) VALUES ($1, 2, 'Primary', 1)",
      [DEVICE_A],
    );

    await seedNode(db, { nodeId: 101, hopsAway: 1, hwModel: 10 });
    await seedNode(db, { nodeId: 202, hopsAway: 2, hwModel: 99 });
    await seedNode(db, { nodeId: 101, deviceId: DEVICE_B, hopsAway: 3, hwModel: 10 });

    await seedMessage(db, { rxTime: recent, fromNodeId: 101, role: "received" });
    await seedMessage(db, { rxTime: recent, fromNodeId: 101, role: "relayed" });
    for (const latency of [100, 1_000, 5_000, 30_000, 70_000]) {
      await seedMessage(db, {
        rxTime: recent,
        fromNodeId: 202,
        role: "sent",
        wantAck: true,
        ackStatus: "acked",
        ackAt: new Date(new Date(recent).getTime() + latency).toISOString(),
      });
    }
    await seedMessage(db, {
      rxTime: recent,
      fromNodeId: 202,
      role: "sent",
      wantAck: true,
      ackStatus: "error",
      ackError: "NO_ROUTE",
    });
    await seedMessage(db, {
      rxTime: recent,
      fromNodeId: 202,
      role: "sent",
      wantAck: true,
      ackStatus: "pending",
    });
    await seedMessage(db, { rxTime: recent, deviceId: DEVICE_B, fromNodeId: 909 });
    await seedMessage(db, { rxTime: old, fromNodeId: 808, role: "received" });

    await seedPacket(db, {
      id: "csv-packet",
      packetId: 4242,
      rxTime: recent,
      fromNodeId: 101,
      toNodeId: 202,
      rxSnr: 2,
      rxRssi: -100,
      hopLimit: 2,
      hopStart: 3,
      viaMqtt: true,
    });
    await seedPacket(db, {
      rxTime: recentEarlier,
      fromNodeId: 101,
      toNodeId: 202,
      rxSnr: 4,
      rxRssi: null,
      hopLimit: 1,
      hopStart: 2,
    });
    await seedPacket(db, {
      rxTime: recentEarlier,
      fromNodeId: 303,
      portnum: 67,
      portnumName: "TELEMETRY_APP",
      decodedJson: {
        variant: {
          case: "deviceMetrics",
          value: {
            batteryLevel: 88,
            voltage: 4.1,
            channelUtilization: 12.5,
            airUtilTx: 3.5,
            uptimeSeconds: 600,
          },
        },
      },
    });
    await seedPacket(db, {
      rxTime: recentEarlier,
      fromNodeId: 404,
      portnum: 71,
      portnumName: "NEIGHBORINFO_APP",
      decodedJson: { neighbors: [{ nodeId: 505, snr: -3.5 }, { nodeId: 404 }, { nodeId: 606 }] },
    });
    await seedPacket(db, {
      rxTime: recent,
      deviceId: DEVICE_B,
      fromNodeId: 707,
      toNodeId: 808,
      rxSnr: 9,
      portnumName: "POSITION_APP",
      portnum: 3,
    });
    await seedPacket(db, {
      rxTime: old,
      fromNodeId: 808,
      portnumName: "OLD_APP",
      portnum: 99,
      rxSnr: -10,
    });

    await seedPosition(db, {
      id: "position-new",
      nodeId: 101,
      latitude: 40.123,
      longitude: -124.456,
      altitude: 123,
      speed: 2.5,
      groundTrack: 90,
      satsInView: 8,
      recordedAt: recent,
    });
    await seedPosition(db, {
      id: "position-nullables",
      nodeId: 202,
      latitude: 41,
      longitude: -125,
      recordedAt: recentEarlier,
    });
    await seedPosition(db, {
      id: "position-other-device",
      deviceId: DEVICE_B,
      nodeId: 909,
      latitude: 42,
      longitude: -126,
      recordedAt: recent,
    });
    await seedPosition(db, {
      id: "position-old",
      nodeId: 808,
      latitude: 1,
      longitude: 2,
      recordedAt: old,
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe("GET /api/analytics/snr-history", () => {
    it("maps bucketed signal values and numeric fields", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/snr-history?deviceId=${DEVICE_A}&nodeId=101&since=1h`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        {
          ts: truncateIso(recentEarlier, "fiveMinutes"),
          nodeId: 101,
          snr: 3,
          rssi: -100,
          count: 2,
        },
      ]);
    });

    it("returns an empty array with no matching signal rows", async () => {
      const res = await app.inject({ method: "GET", url: "/api/analytics/snr-history?nodeId=999" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("rejects a non-numeric nodeId", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/analytics/snr-history?nodeId=nope",
      });
      expect(res.statusCode).toBe(400);
      expectValidationError(res.json(), "nodeId");
    });
  });

  describe("GET /api/analytics/message-volume", () => {
    it("maps role counts into an hourly bucket", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/message-volume?deviceId=${DEVICE_A}&since=1h&bucket=hour`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        { ts: truncateIso(recent, "hour"), received: 1, sent: 7, relayed: 1, total: 9 },
      ]);
    });

    it("returns an empty array for a device with no messages", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/message-volume?deviceId=${MISSING_DEVICE}`,
      });
      expect(res.json()).toEqual([]);
    });

    it("rejects an unsupported bucket", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/analytics/message-volume?bucket=week",
      });
      expect(res.statusCode).toBe(400);
      expectValidationError(res.json(), "bucket");
    });
  });

  describe("GET /api/analytics/message-delivery", () => {
    it("returns delivery totals and mapped error types", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/message-delivery?deviceId=${DEVICE_A}&since=1h`,
      });
      expect(res.json()).toEqual({
        acked: 5,
        pending: 1,
        error: 1,
        total: 7,
        errorTypes: [{ type: "NO_ROUTE", count: 1 }],
      });
    });

    it("returns a zeroed aggregate when nothing matches", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/message-delivery?deviceId=${MISSING_DEVICE}`,
      });
      expect(res.json()).toEqual({ acked: 0, pending: 0, error: 0, total: 0, errorTypes: [] });
    });

    it("treats missing since as all history and still applies deviceId", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/message-delivery?deviceId=${DEVICE_A}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ acked: 5, total: 7 });
    });
  });

  describe("GET /api/analytics/busiest-nodes", () => {
    it("ranks nodes and converts counts to numbers", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/busiest-nodes?deviceId=${DEVICE_A}&since=1h`,
      });
      expect(res.json()).toEqual([
        { nodeId: 202, received: 0, sent: 7, relayed: 0, total: 7 },
        { nodeId: 101, received: 1, sent: 0, relayed: 1, total: 2 },
      ]);
    });

    it("returns an empty array for an unmatched combined filter", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/busiest-nodes?since=1h&deviceId=${MISSING_DEVICE}`,
      });
      expect(res.json()).toEqual([]);
    });

    it("rejects non-numeric and out-of-range limits", async () => {
      for (const limit of ["nope", "0", "101"]) {
        const res = await app.inject({
          method: "GET",
          url: `/api/analytics/busiest-nodes?limit=${limit}`,
        });
        expect(res.statusCode).toBe(400);
        expectValidationError(res.json(), "limit");
      }
    });
  });

  describe("GET /api/analytics/portnum-breakdown", () => {
    it("maps packet application counts", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/portnum-breakdown?deviceId=${DEVICE_A}&since=1h`,
      });
      expect(res.json()).toEqual([
        { portnumName: "TEXT_MESSAGE_APP", count: 2 },
        { portnumName: "NEIGHBORINFO_APP", count: 1 },
        { portnumName: "TELEMETRY_APP", count: 1 },
      ]);
    });

    it("returns an empty array when no packets match", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/portnum-breakdown?deviceId=${MISSING_DEVICE}`,
      });
      expect(res.json()).toEqual([]);
    });

    it("honors an ISO since boundary", async () => {
      const future = encodeURIComponent(new Date(Date.now() + 60_000).toISOString());
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/portnum-breakdown?deviceId=${DEVICE_A}&since=${future}`,
      });
      expect(res.json()).toEqual([]);
    });
  });

  describe("GET /api/analytics/packet-timeline", () => {
    it("pivots portnum counts into minute buckets", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/packet-timeline?deviceId=${DEVICE_A}&since=1h&bucket=minute`,
      });
      const body = res.json() as Array<{
        ts: string;
        counts: Record<string, number>;
        total: number;
      }>;
      expect(body).toHaveLength(recent.slice(0, 16) === recentEarlier.slice(0, 16) ? 1 : 2);
      expect(body.reduce((sum, row) => sum + row.total, 0)).toBe(4);
      expect(
        body.every((row) => typeof row.ts === "string" && typeof row.counts === "object"),
      ).toBe(true);
      expect(body.flatMap((row) => Object.entries(row.counts))).toEqual(
        expect.arrayContaining([
          ["TEXT_MESSAGE_APP", expect.any(Number)],
          ["TELEMETRY_APP", 1],
          ["NEIGHBORINFO_APP", 1],
        ]),
      );
    });

    it("returns an empty pivot when no packets match", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/packet-timeline?deviceId=${MISSING_DEVICE}`,
      });
      expect(res.json()).toEqual([]);
    });

    it("rejects an unsupported bucket", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/analytics/packet-timeline?bucket=day",
      });
      expect(res.statusCode).toBe(400);
      expectValidationError(res.json(), "bucket");
    });
  });

  describe("GET /api/analytics/hop-distribution", () => {
    it("maps distinct node counts by hop distance", async () => {
      const res = await app.inject({ method: "GET", url: "/api/analytics/hop-distribution" });
      expect(res.json()).toEqual([
        { hopsAway: 1, count: 1 },
        { hopsAway: 2, count: 1 },
        { hopsAway: 3, count: 1 },
      ]);
    });

    it("returns an empty array for an unmatched device", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/hop-distribution?deviceId=${MISSING_DEVICE}`,
      });
      expect(res.json()).toEqual([]);
    });

    it("filters hop counts by deviceId", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/hop-distribution?deviceId=${DEVICE_B}`,
      });
      expect(res.json()).toEqual([{ hopsAway: 3, count: 1 }]);
    });
  });

  describe("GET /api/analytics/hardware-breakdown", () => {
    it("resolves known hardware and falls back for unknown models", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/hardware-breakdown?deviceId=${DEVICE_A}`,
      });
      expect(res.json()).toEqual(
        expect.arrayContaining([
          { hwModel: 10, hwModelName: "TBEAM", count: 1 },
          { hwModel: 99, hwModelName: "Model 99", count: 1 },
        ]),
      );
    });

    it("returns an empty array for an unmatched device", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/hardware-breakdown?deviceId=${MISSING_DEVICE}`,
      });
      expect(res.json()).toEqual([]);
    });

    it("deduplicates and filters hardware counts by deviceId", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/hardware-breakdown?deviceId=${DEVICE_B}`,
      });
      expect(res.json()).toEqual([{ hwModel: 10, hwModelName: "TBEAM", count: 1 }]);
    });
  });

  describe("GET /api/analytics/channel-utilization", () => {
    it("maps named channel role counts", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/channel-utilization?deviceId=${DEVICE_A}&since=1h`,
      });
      expect(res.json()).toEqual([
        { channelIndex: 2, channelName: "Primary", received: 1, sent: 7, relayed: 1, total: 9 },
      ]);
    });

    it("returns an empty array for an unmatched combined filter", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/channel-utilization?since=1h&deviceId=${MISSING_DEVICE}`,
      });
      expect(res.json()).toEqual([]);
    });

    it("silently ignores a garbage since string while retaining device filtering", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/channel-utilization?since=garbage&deviceId=${DEVICE_A}`,
      });
      expect(res.json()).toEqual([
        { channelIndex: 2, channelName: "Primary", received: 2, sent: 7, relayed: 1, total: 10 },
      ]);
    });
  });

  describe("GET /api/analytics/message-latency", () => {
    it("uses the nearest-rank percentile algorithm and exact latency buckets", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/message-latency?deviceId=${DEVICE_A}&since=1h`,
      });
      expect(res.json()).toEqual({
        buckets: [
          { label: "<1s", maxMs: 1000, count: 2 },
          { label: "1-5s", maxMs: 5000, count: 1 },
          { label: "5-30s", maxMs: 30000, count: 1 },
          { label: "30s-1m", maxMs: 60000, count: 0 },
          { label: ">1m", maxMs: null, count: 1 },
        ],
        medianMs: 5000,
        p95Ms: 70000,
        totalSamples: 5,
      });
    });

    it("returns zeroed buckets and null percentiles with no samples", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/message-latency?deviceId=${MISSING_DEVICE}`,
      });
      expect(res.json()).toEqual({
        buckets: [
          { label: "<1s", maxMs: 1000, count: 0 },
          { label: "1-5s", maxMs: 5000, count: 0 },
          { label: "5-30s", maxMs: 30000, count: 0 },
          { label: "30s-1m", maxMs: 60000, count: 0 },
          { label: ">1m", maxMs: null, count: 0 },
        ],
        medianMs: null,
        p95Ms: null,
        totalSamples: 0,
      });
    });

    it("applies deviceId together with the all time range", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/message-latency?deviceId=${DEVICE_A}&since=all`,
      });
      expect(res.json()).toMatchObject({ medianMs: 5000, p95Ms: 70000, totalSamples: 5 });
    });
  });

  describe("GET /api/analytics/telemetry-history", () => {
    it("maps decoded telemetry metrics and missing metrics to null", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/telemetry-history?deviceId=${DEVICE_A}&nodeId=303&since=1h`,
      });
      expect(res.json()).toEqual([
        {
          ts: truncateIso(recentEarlier, "fiveMinutes"),
          nodeId: 303,
          variantCase: "deviceMetrics",
          batteryLevel: 88,
          voltage: 4.1,
          channelUtilization: 12.5,
          airUtilTx: 3.5,
          uptimeSeconds: 600,
          temperature: null,
          relativeHumidity: null,
          barometricPressure: null,
        },
      ]);
    });

    it("returns an empty array when no telemetry matches", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/analytics/telemetry-history?nodeId=999",
      });
      expect(res.json()).toEqual([]);
    });

    it("rejects a non-numeric nodeId", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/analytics/telemetry-history?nodeId=NaN",
      });
      expect(res.statusCode).toBe(400);
      expectValidationError(res.json(), "nodeId");
    });
  });

  describe("GET /api/analytics/link-quality", () => {
    it("maps pair averages and numeric message counts", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/link-quality?deviceId=${DEVICE_A}&since=1h`,
      });
      expect(res.json()).toEqual([{ fromNodeId: 101, toNodeId: 202, avgSnr: 3, messageCount: 2 }]);
    });

    it("returns an empty array for an unmatched combined filter", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/link-quality?since=1h&deviceId=${MISSING_DEVICE}`,
      });
      expect(res.json()).toEqual([]);
    });

    it("uses all history when since=all while retaining deviceId", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/link-quality?since=all&deviceId=${DEVICE_A}`,
      });
      expect(res.json()).toEqual(
        expect.arrayContaining([
          { fromNodeId: 101, toNodeId: 202, avgSnr: 3, messageCount: 2 },
          { fromNodeId: 808, toNodeId: 202, avgSnr: -10, messageCount: 1 },
        ]),
      );
    });
  });

  describe("GET /api/analytics/node-activity", () => {
    it("merges message and packet counts into hourly node buckets", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/node-activity?deviceId=${DEVICE_A}&since=1h&bucket=hour`,
      });
      const body = res.json() as Array<{ ts: string; nodeId: number; count: number }>;
      expect(body).toEqual(
        expect.arrayContaining([
          { ts: truncateIso(recent, "hour"), nodeId: 101, count: 4 },
          { ts: truncateIso(recent, "hour"), nodeId: 202, count: 7 },
          { ts: truncateIso(recent, "hour"), nodeId: 303, count: 1 },
          { ts: truncateIso(recent, "hour"), nodeId: 404, count: 1 },
        ]),
      );
      expect(
        body.every((row) => typeof row.nodeId === "number" && typeof row.count === "number"),
      ).toBe(true);
    });

    it("returns an empty array when neither source table matches", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/node-activity?deviceId=${MISSING_DEVICE}`,
      });
      expect(res.json()).toEqual([]);
    });

    it("rejects an unsupported bucket", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/analytics/node-activity?bucket=minute",
      });
      expect(res.statusCode).toBe(400);
      expectValidationError(res.json(), "bucket");
    });
  });

  describe("GET /api/analytics/neighbor-graph", () => {
    it("flattens neighbors, skips self-links, and maps absent SNR to null", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/neighbor-graph?deviceId=${DEVICE_A}&since=1h`,
      });
      expect(res.json()).toEqual([
        { fromNodeId: 404, toNodeId: 505, snr: -3.5, lastSeen: recentEarlier },
        { fromNodeId: 404, toNodeId: 606, snr: null, lastSeen: recentEarlier },
      ]);
    });

    it("returns an empty array for an unmatched device", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/neighbor-graph?deviceId=${MISSING_DEVICE}`,
      });
      expect(res.json()).toEqual([]);
    });

    it("accepts all as an unbounded time range", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/neighbor-graph?deviceId=${DEVICE_A}&since=all`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });
  });

  describe("GET /api/analytics/position-history", () => {
    it("maps position fields, including nullable values", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/position-history?deviceId=${DEVICE_A}&nodeId=101&since=1h`,
      });
      expect(res.json()).toEqual([
        {
          id: "position-new",
          nodeId: 101,
          latitude: 40.123,
          longitude: -124.456,
          altitude: 123,
          speed: 2.5,
          groundTrack: 90,
          satsInView: 8,
          recordedAt: recent,
        },
      ]);
    });

    it("returns an empty array when no fixes match", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/analytics/position-history?nodeId=999",
      });
      expect(res.json()).toEqual([]);
    });

    it("rejects invalid nodeId and out-of-range limit", async () => {
      const invalid = await app.inject({
        method: "GET",
        url: "/api/analytics/position-history?nodeId=bad",
      });
      expect(invalid.statusCode).toBe(400);
      expectValidationError(invalid.json(), "nodeId");

      const limited = await app.inject({
        method: "GET",
        url: `/api/analytics/position-history?deviceId=${DEVICE_A}&since=all&limit=-9`,
      });
      expect(limited.statusCode).toBe(400);
      expectValidationError(limited.json(), "limit");
    });
  });

  describe("GET /api/analytics/packet-log", () => {
    it("maps raw packet columns to typed camelCase JSON", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/packet-log?deviceId=${DEVICE_A}&portnum=TEXT_MESSAGE_APP&since=1h&limit=1`,
      });
      expect(res.json()).toEqual([
        {
          id: "csv-packet",
          packetId: 4242,
          deviceId: DEVICE_A,
          fromNodeId: 101,
          toNodeId: 202,
          portnumName: "TEXT_MESSAGE_APP",
          rxTime: recent,
          rxSnr: 2,
          rxRssi: -100,
          hopLimit: 2,
          hopStart: 3,
          viaMqtt: true,
        },
      ]);
    });

    it("returns an empty array for an unmatched portnum", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/analytics/packet-log?portnum=NOPE",
      });
      expect(res.json()).toEqual([]);
    });

    it("rejects non-numeric and out-of-range limit/offset values", async () => {
      for (const [field, value] of [
        ["limit", "nope"],
        ["limit", "5001"],
        ["offset", "nope"],
        ["offset", "-1"],
        ["offset", "5001"],
      ]) {
        const res = await app.inject({
          method: "GET",
          url: `/api/analytics/packet-log?${field}=${value}`,
        });
        expect(res.statusCode).toBe(400);
        expectValidationError(res.json(), field);
      }
    });

    it("rejects a non-UUID deviceId before querying", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/analytics/packet-log?deviceId=not-a-uuid",
      });
      expect(res.statusCode).toBe(400);
      expectValidationError(res.json(), "deviceId");
    });
  });

  describe("GET /api/analytics/packet-log.csv", () => {
    const header =
      "id,packetId,deviceId,fromNodeId,toNodeId,portnumName,rxTime,rxSnr,rxRssi,hopLimit,hopStart,viaMqtt\n";

    it("returns a CSV attachment with exact field order and values", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/packet-log.csv?deviceId=${DEVICE_A}&portnum=TEXT_MESSAGE_APP&since=1h`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toBe('attachment; filename="packet-log-1h.csv"');
      const lines = res.body.split("\n");
      expect(lines[0] + "\n").toBe(header);
      expect(lines[1]).toBe(
        `csv-packet,4242,${DEVICE_A},101,202,TEXT_MESSAGE_APP,${recent},2,-100,2,3,true`,
      );
      expect(lines).toHaveLength(3);
    });

    it("returns only the header when no packets match", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/packet-log.csv?deviceId=${MISSING_DEVICE}&since=24h`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(header);
    });

    it("silently ignores garbage since values and includes historic matching rows", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/analytics/packet-log.csv?deviceId=${DEVICE_A}&portnum=OLD_APP&since=garbage`,
      });
      expect(res.headers["content-disposition"]).toBe(
        'attachment; filename="packet-log-garbage.csv"',
      );
      expect(res.body).toContain(`,${DEVICE_A},808,202,OLD_APP,${old},-10,,,,false`);
    });
  });
});
