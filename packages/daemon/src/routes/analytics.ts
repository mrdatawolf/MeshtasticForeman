import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a `since` query param into a Date.
 * Accepts shorthand ("1h", "6h", "24h", "7d", "30d") or any ISO 8601 string.
 * Returns null if the value is "all", omitted, or unparseable.
 */
function parseSince(since: string | undefined): Date | null {
  if (!since || since === "all") return null;
  const shorthand = since.match(/^(\d+)(h|d)$/);
  if (shorthand) {
    const n = parseInt(shorthand[1], 10);
    const unit = shorthand[2];
    const ms = unit === "h" ? n * 3_600_000 : n * 86_400_000;
    return new Date(Date.now() - ms);
  }
  const ts = new Date(since);
  return isNaN(ts.getTime()) ? null : ts;
}

/** Build a WHERE clause fragment and params array from common filter options. */
function buildFilters(opts: {
  since?: string;
  deviceId?: string;
  timeCol?: string; // defaults to "rx_time"
}): { where: string; params: unknown[] } {
  const { since, deviceId, timeCol = "rx_time" } = opts;
  const conditions: string[] = [];
  const params: unknown[] = [];

  const sinceDate = parseSince(since);
  if (sinceDate) {
    params.push(sinceDate.toISOString());
    conditions.push(`${timeCol} >= $${params.length}`);
  }
  if (deviceId) {
    params.push(deviceId);
    conditions.push(`device_id = $${params.length}`);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerAnalyticsRoutes(app: FastifyInstance, db: PGlite) {
  // ── 1. SNR History ─────────────────────────────────────────────────────────
  // Returns time-bucketed average SNR and RSSI per node from the packets table.
  // Uses packets (not messages) so all packet types contribute signal data —
  // NodeInfo, position, telemetry, text, etc. — not just text messages.
  // Useful for line charts showing signal quality over time.
  //
  // Query params:
  //   since    – time window (default "24h")
  //   nodeId   – filter to one node (numeric)
  //   deviceId – filter to one device (UUID)
  app.get("/api/analytics/snr-history", async (req, reply) => {
    const {
      since = "24h",
      nodeId,
      deviceId,
    } = req.query as {
      since?: string;
      nodeId?: string;
      deviceId?: string;
    };

    const conditions: string[] = [];
    const params: unknown[] = [];

    const sinceDate = parseSince(since);
    if (sinceDate) {
      params.push(sinceDate.toISOString());
      conditions.push(`rx_time >= $${params.length}`);
    }
    if (deviceId) {
      params.push(deviceId);
      conditions.push(`device_id = $${params.length}`);
    }
    if (nodeId) {
      const nid = Number(nodeId);
      if (!Number.isFinite(nid)) return reply.status(400).send({ error: "Invalid nodeId" });
      params.push(nid);
      conditions.push(`from_node_id = $${params.length}`);
    }

    // Only include messages that actually have signal data
    conditions.push("(rx_snr IS NOT NULL OR rx_rssi IS NOT NULL)");

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // 5-minute buckets via epoch floor arithmetic
    const { rows } = await db.query<{
      ts: string;
      node_id: string;
      snr: number | null;
      rssi: number | null;
      count: string;
    }>(
      `
      SELECT
        to_timestamp(floor(EXTRACT(epoch FROM rx_time) / 300) * 300) AS ts,
        from_node_id AS node_id,
        AVG(rx_snr)::REAL                                            AS snr,
        AVG(rx_rssi)::REAL                                           AS rssi,
        COUNT(*)                                                      AS count
      FROM packets
      ${where}
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC
    `,
      params,
    );

    return rows.map((r) => ({
      ts: new Date(r.ts).toISOString(),
      nodeId: Number(r.node_id),
      snr: r.snr ?? null,
      rssi: r.rssi ?? null,
      count: Number(r.count),
    }));
  });

  // ── 2. Message Volume ───────────────────────────────────────────────────────
  // Returns message counts bucketed by time and broken down by role
  // (received / sent / relayed). Drives the stacked area/bar chart.
  //
  // Query params:
  //   since    – default "7d"
  //   bucket   – "hour" | "day" (default "hour")
  //   deviceId – filter to one device
  app.get("/api/analytics/message-volume", async (req, reply) => {
    const {
      since = "7d",
      bucket = "hour",
      deviceId,
    } = req.query as {
      since?: string;
      bucket?: string;
      deviceId?: string;
    };

    if (bucket !== "hour" && bucket !== "day") {
      return reply.status(400).send({ error: "bucket must be 'hour' or 'day'" });
    }

    const { where, params } = buildFilters({ since, deviceId });

    const { rows } = await db.query<{
      ts: string;
      received: string;
      sent: string;
      relayed: string;
      total: string;
    }>(
      `
      SELECT
        date_trunc('${bucket}', rx_time)                         AS ts,
        COUNT(*) FILTER (WHERE role = 'received')                AS received,
        COUNT(*) FILTER (WHERE role = 'sent')                    AS sent,
        COUNT(*) FILTER (WHERE role = 'relayed')                 AS relayed,
        COUNT(*)                                                  AS total
      FROM messages
      ${where}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
      params,
    );

    return rows.map((r) => ({
      ts: new Date(r.ts).toISOString(),
      received: Number(r.received),
      sent: Number(r.sent),
      relayed: Number(r.relayed),
      total: Number(r.total),
    }));
  });

  // ── 3. Message Delivery ─────────────────────────────────────────────────────
  // Delivery success breakdown for sent messages that requested an ACK.
  // Drives the delivery rate donut chart.
  //
  // Query params:
  //   since    – default "all"
  //   deviceId – filter to one device
  app.get("/api/analytics/message-delivery", async (req, _reply) => {
    const { since, deviceId } = req.query as {
      since?: string;
      deviceId?: string;
    };

    const conditions: string[] = ["role = 'sent'", "want_ack = true"];
    const params: unknown[] = [];

    const sinceDate = parseSince(since);
    if (sinceDate) {
      params.push(sinceDate.toISOString());
      conditions.push(`rx_time >= $${params.length}`);
    }
    if (deviceId) {
      params.push(deviceId);
      conditions.push(`device_id = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const [statusRows, errorRows] = await Promise.all([
      db.query<{ ack_status: string | null; count: string }>(
        `
        SELECT ack_status, COUNT(*) AS count
        FROM messages
        ${where}
        GROUP BY ack_status
      `,
        params,
      ),

      db.query<{ ack_error: string | null; count: string }>(
        `
        SELECT ack_error, COUNT(*) AS count
        FROM messages
        ${where}
        AND ack_status = 'error' AND ack_error IS NOT NULL
        GROUP BY ack_error
        ORDER BY 2 DESC
      `,
        params,
      ),
    ]);

    let acked = 0,
      pending = 0,
      error = 0;
    for (const r of statusRows.rows) {
      const n = Number(r.count);
      if (r.ack_status === "acked") acked = n;
      if (r.ack_status === "pending") pending = n;
      if (r.ack_status === "error") error = n;
    }

    return {
      acked,
      pending,
      error,
      total: acked + pending + error,
      errorTypes: errorRows.rows.map((r) => ({
        type: r.ack_error ?? "unknown",
        count: Number(r.count),
      })),
    };
  });

  // ── 4. Busiest Nodes ────────────────────────────────────────────────────────
  // Nodes ranked by total message activity (as sender).
  // Drives the horizontal bar chart.
  //
  // Query params:
  //   since    – default "7d"
  //   limit    – max rows (default 20)
  //   deviceId – filter to one device
  app.get("/api/analytics/busiest-nodes", async (req, _reply) => {
    const {
      since = "7d",
      limit = "20",
      deviceId,
    } = req.query as {
      since?: string;
      limit?: string;
      deviceId?: string;
    };

    const maxRows = Math.min(Math.max(1, Number(limit) || 20), 100);
    const { where, params } = buildFilters({ since, deviceId });

    params.push(maxRows);
    const limitClause = `LIMIT $${params.length}`;

    const { rows } = await db.query<{
      node_id: string;
      received: string;
      sent: string;
      relayed: string;
      total: string;
    }>(
      `
      SELECT
        from_node_id                                              AS node_id,
        COUNT(*) FILTER (WHERE role = 'received')                AS received,
        COUNT(*) FILTER (WHERE role = 'sent')                    AS sent,
        COUNT(*) FILTER (WHERE role = 'relayed')                 AS relayed,
        COUNT(*)                                                  AS total
      FROM messages
      ${where}
      GROUP BY from_node_id
      ORDER BY total DESC
      ${limitClause}
    `,
      params,
    );

    return rows.map((r) => ({
      nodeId: Number(r.node_id),
      received: Number(r.received),
      sent: Number(r.sent),
      relayed: Number(r.relayed),
      total: Number(r.total),
    }));
  });

  // ── 5. Portnum Breakdown ────────────────────────────────────────────────────
  // Packet counts grouped by application type (portnum_name).
  // Drives the portnum donut chart.
  //
  // Query params:
  //   since    – default "24h"
  //   deviceId – filter to one device
  app.get("/api/analytics/portnum-breakdown", async (req, _reply) => {
    const { since = "24h", deviceId } = req.query as {
      since?: string;
      deviceId?: string;
    };

    const { where, params } = buildFilters({ since, deviceId });

    const { rows } = await db.query<{
      portnum_name: string;
      count: string;
    }>(
      `
      SELECT
        portnum_name,
        COUNT(*) AS count
      FROM packets
      ${where}
      GROUP BY portnum_name
      ORDER BY 2 DESC
    `,
      params,
    );

    return rows.map((r) => ({
      portnumName: r.portnum_name,
      count: Number(r.count),
    }));
  });

  // ── 6. Packet Timeline ──────────────────────────────────────────────────────
  // Packet counts over time broken down by portnum_name.
  // Drives the stacked area chart on the Packets tab.
  //
  // Query params:
  //   since    – default "24h"
  //   bucket   – "minute" | "hour" (default "hour")
  //   deviceId – filter to one device
  app.get("/api/analytics/packet-timeline", async (req, reply) => {
    const {
      since = "24h",
      bucket = "hour",
      deviceId,
    } = req.query as {
      since?: string;
      bucket?: string;
      deviceId?: string;
    };

    if (bucket !== "minute" && bucket !== "hour") {
      return reply.status(400).send({ error: "bucket must be 'minute' or 'hour'" });
    }

    const { where, params } = buildFilters({ since, deviceId });

    const { rows } = await db.query<{
      ts: string;
      portnum_name: string;
      count: string;
    }>(
      `
      SELECT
        date_trunc('${bucket}', rx_time) AS ts,
        portnum_name,
        COUNT(*)                          AS count
      FROM packets
      ${where}
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC
    `,
      params,
    );

    // Pivot: group rows by timestamp, merge portnum counts into an object
    const byTs = new Map<string, { ts: string; counts: Record<string, number>; total: number }>();
    for (const r of rows) {
      const ts = new Date(r.ts).toISOString();
      if (!byTs.has(ts)) byTs.set(ts, { ts, counts: {}, total: 0 });
      const entry = byTs.get(ts)!;
      const n = Number(r.count);
      entry.counts[r.portnum_name] = (entry.counts[r.portnum_name] ?? 0) + n;
      entry.total += n;
    }

    return [...byTs.values()].sort((a, b) => a.ts.localeCompare(b.ts));
  });

  // ── 7. Hop Distribution ─────────────────────────────────────────────────────
  // Count of nodes at each hop distance from our gateway.
  // Drives the hop histogram bar chart.
  //
  // Query params:
  //   deviceId – filter to one device
  app.get("/api/analytics/hop-distribution", async (req, _reply) => {
    const { deviceId } = req.query as { deviceId?: string };

    // Deduplicate: a node may appear on multiple devices; count unique nodeIds
    const conditions: string[] = ["hops_away IS NOT NULL"];
    const params: unknown[] = [];

    if (deviceId) {
      params.push(deviceId);
      conditions.push(`device_id = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const { rows } = await db.query<{
      hops_away: number;
      count: string;
    }>(
      `
      SELECT
        hops_away,
        COUNT(DISTINCT node_id) AS count
      FROM nodes
      ${where}
      GROUP BY hops_away
      ORDER BY hops_away ASC
    `,
      params,
    );

    return rows.map((r) => ({
      hopsAway: r.hops_away,
      count: Number(r.count),
    }));
  });

  // ── 8. Hardware Breakdown ───────────────────────────────────────────────────
  // Count of nodes by hardware model, with resolved model names.
  // Drives the hardware model pie chart.
  //
  // Query params:
  //   deviceId – filter to one device
  app.get("/api/analytics/hardware-breakdown", async (req, _reply) => {
    const { deviceId } = req.query as { deviceId?: string };

    const conditions: string[] = ["n.hw_model IS NOT NULL"];
    const params: unknown[] = [];

    if (deviceId) {
      params.push(deviceId);
      conditions.push(`n.device_id = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const { rows } = await db.query<{
      hw_model: number;
      hw_model_name: string | null;
      count: string;
    }>(
      `
      SELECT
        n.hw_model,
        h.name                         AS hw_model_name,
        COUNT(DISTINCT n.node_id)      AS count
      FROM nodes n
      LEFT JOIN hw_models h ON h.model_num = n.hw_model
      ${where}
      GROUP BY n.hw_model, h.name
      ORDER BY 3 DESC
    `,
      params,
    );

    return rows.map((r) => ({
      hwModel: r.hw_model,
      hwModelName: r.hw_model_name ?? `Model ${r.hw_model}`,
      count: Number(r.count),
    }));
  });

  // ── 9. Channel Utilization ──────────────────────────────────────────────────
  // Message counts per channel index, with channel names from the channels table.
  // Drives the channel bar chart.
  //
  // Query params:
  //   since    – default "7d"
  //   deviceId – filter to one device
  app.get("/api/analytics/channel-utilization", async (req, _reply) => {
    const { since = "7d", deviceId } = req.query as {
      since?: string;
      deviceId?: string;
    };

    const conditions: string[] = [];
    const params: unknown[] = [];

    const sinceDate = parseSince(since);
    if (sinceDate) {
      params.push(sinceDate.toISOString());
      conditions.push(`m.rx_time >= $${params.length}`);
    }
    if (deviceId) {
      params.push(deviceId);
      conditions.push(`m.device_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await db.query<{
      channel_index: number;
      channel_name: string | null;
      received: string;
      sent: string;
      relayed: string;
      total: string;
    }>(
      `
      SELECT
        m.channel_index,
        c.name                                                    AS channel_name,
        COUNT(*) FILTER (WHERE m.role = 'received')              AS received,
        COUNT(*) FILTER (WHERE m.role = 'sent')                  AS sent,
        COUNT(*) FILTER (WHERE m.role = 'relayed')               AS relayed,
        COUNT(*)                                                  AS total
      FROM messages m
      LEFT JOIN channels c
        ON c.device_id = m.device_id
       AND c.idx       = m.channel_index
      ${where}
      GROUP BY m.channel_index, c.name
      ORDER BY m.channel_index ASC
    `,
      params,
    );

    return rows.map((r) => ({
      channelIndex: r.channel_index,
      channelName: r.channel_name ?? null,
      received: Number(r.received),
      sent: Number(r.sent),
      relayed: Number(r.relayed),
      total: Number(r.total),
    }));
  });

  // ── 10. Message Latency ─────────────────────────────────────────────────────
  // Delivery latency histogram for sent messages that were ACKed.
  // Computes (ack_at - rx_time) and buckets the results.
  //
  // Query params:
  //   since    – default "7d"
  //   deviceId – filter to one device
  app.get("/api/analytics/message-latency", async (req, _reply) => {
    const { since = "7d", deviceId } = req.query as {
      since?: string;
      deviceId?: string;
    };

    const conditions: string[] = ["role = 'sent'", "ack_status = 'acked'", "ack_at IS NOT NULL"];
    const params: unknown[] = [];

    const sinceDate = parseSince(since);
    if (sinceDate) {
      params.push(sinceDate.toISOString());
      conditions.push(`rx_time >= $${params.length}`);
    }
    if (deviceId) {
      params.push(deviceId);
      conditions.push(`device_id = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const { rows } = await db.query<{ latency_ms: number }>(
      `
      SELECT EXTRACT(epoch FROM (ack_at - rx_time)) * 1000 AS latency_ms
      FROM messages
      ${where}
      ORDER BY latency_ms ASC
    `,
      params,
    );

    if (rows.length === 0) {
      return {
        buckets: LATENCY_BUCKETS.map((b) => ({ label: b.label, maxMs: b.maxMs, count: 0 })),
        medianMs: null,
        p95Ms: null,
        totalSamples: 0,
      };
    }

    // Bucket counts
    const buckets = LATENCY_BUCKETS.map((b) => ({ ...b, count: 0 }));
    for (const { latency_ms } of rows) {
      const ms = Number(latency_ms);
      const bucket = buckets.find((b) => ms <= b.maxMs) ?? buckets[buckets.length - 1];
      bucket.count++;
    }

    // Percentiles (rows are already sorted ASC)
    const values = rows.map((r) => Number(r.latency_ms));
    const medianMs = percentile(values, 50);
    const p95Ms = percentile(values, 95);

    return {
      buckets: buckets.map(({ label, maxMs, count }) => ({ label, maxMs, count })),
      medianMs,
      p95Ms,
      totalSamples: values.length,
    };
  });

  // ── 11. Telemetry History ───────────────────────────────────────────────────
  // Returns time-bucketed telemetry readings per node from TELEMETRY_APP packets.
  // Covers device metrics (battery, channel util, airtime) and environment
  // metrics (temperature, humidity, pressure) in one query.
  //
  // Query params:
  //   since    – default "24h"
  //   nodeId   – filter to one node
  //   deviceId – filter to one device
  app.get("/api/analytics/telemetry-history", async (req, reply) => {
    const {
      since = "24h",
      nodeId,
      deviceId,
    } = req.query as {
      since?: string;
      nodeId?: string;
      deviceId?: string;
    };

    const conditions: string[] = ["portnum_name = 'TELEMETRY_APP'", "decoded_json IS NOT NULL"];
    const params: unknown[] = [];

    const sinceDate = parseSince(since);
    if (sinceDate) {
      params.push(sinceDate.toISOString());
      conditions.push(`rx_time >= $${params.length}`);
    }
    if (deviceId) {
      params.push(deviceId);
      conditions.push(`device_id = $${params.length}`);
    }
    if (nodeId) {
      const nid = Number(nodeId);
      if (!Number.isFinite(nid)) return reply.status(400).send({ error: "Invalid nodeId" });
      params.push(nid);
      conditions.push(`from_node_id = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    // 5-minute buckets; extract fields from decoded_json by telemetry variant
    const { rows } = await db.query<{
      ts: string;
      node_id: string;
      variant_case: string | null;
      // Device metrics
      battery_level: number | null;
      voltage: number | null;
      channel_utilization: number | null;
      air_util_tx: number | null;
      uptime_seconds: number | null;
      // Environment metrics
      temperature: number | null;
      relative_humidity: number | null;
      barometric_pressure: number | null;
    }>(
      `
      SELECT
        to_timestamp(floor(EXTRACT(epoch FROM rx_time) / 300) * 300)          AS ts,
        from_node_id                                                            AS node_id,
        decoded_json -> 'variant' ->> 'case'                                   AS variant_case,
        -- device metrics (cast text → numeric; field may be absent → null)
        (decoded_json -> 'variant' -> 'value' ->> 'batteryLevel')::numeric     AS battery_level,
        (decoded_json -> 'variant' -> 'value' ->> 'voltage')::numeric          AS voltage,
        (decoded_json -> 'variant' -> 'value' ->> 'channelUtilization')::numeric AS channel_utilization,
        (decoded_json -> 'variant' -> 'value' ->> 'airUtilTx')::numeric        AS air_util_tx,
        (decoded_json -> 'variant' -> 'value' ->> 'uptimeSeconds')::numeric    AS uptime_seconds,
        -- environment metrics
        (decoded_json -> 'variant' -> 'value' ->> 'temperature')::numeric      AS temperature,
        (decoded_json -> 'variant' -> 'value' ->> 'relativeHumidity')::numeric AS relative_humidity,
        (decoded_json -> 'variant' -> 'value' ->> 'barometricPressure')::numeric AS barometric_pressure
      FROM packets
      ${where}
      ORDER BY ts ASC, from_node_id ASC
    `,
      params,
    );

    // Group by bucket + node and average each metric within the bucket
    type Bucket = {
      ts: string;
      nodeId: number;
      variantCase: string | null;
      batteryLevel: number | null;
      voltage: number | null;
      channelUtilization: number | null;
      airUtilTx: number | null;
      uptimeSeconds: number | null;
      temperature: number | null;
      relativeHumidity: number | null;
      barometricPressure: number | null;
    };

    const bucketMap = new Map<
      string,
      {
        sums: Record<string, number>;
        counts: Record<string, number>;
        variantCase: string | null;
        ts: string;
        nodeId: number;
      }
    >();

    const numFields = [
      "batteryLevel",
      "voltage",
      "channelUtilization",
      "airUtilTx",
      "uptimeSeconds",
      "temperature",
      "relativeHumidity",
      "barometricPressure",
    ] as const;
    const dbFields: Record<string, string> = {
      batteryLevel: "battery_level",
      voltage: "voltage",
      channelUtilization: "channel_utilization",
      airUtilTx: "air_util_tx",
      uptimeSeconds: "uptime_seconds",
      temperature: "temperature",
      relativeHumidity: "relative_humidity",
      barometricPressure: "barometric_pressure",
    };

    for (const r of rows) {
      const key = `${r.ts}_${r.node_id}`;
      if (!bucketMap.has(key)) {
        bucketMap.set(key, {
          sums: {},
          counts: {},
          variantCase: r.variant_case,
          ts: new Date(r.ts).toISOString(),
          nodeId: Number(r.node_id),
        });
      }
      const b = bucketMap.get(key)!;
      for (const f of numFields) {
        const val = r[dbFields[f] as keyof typeof r] as number | null;
        if (val !== null && val !== undefined) {
          b.sums[f] = (b.sums[f] ?? 0) + Number(val);
          b.counts[f] = (b.counts[f] ?? 0) + 1;
        }
      }
    }

    const result: Bucket[] = [...bucketMap.values()].map((b) => {
      const avg = (f: string) => (b.counts[f] ? b.sums[f] / b.counts[f] : null);
      return {
        ts: b.ts,
        nodeId: b.nodeId,
        variantCase: b.variantCase,
        batteryLevel: avg("batteryLevel"),
        voltage: avg("voltage"),
        channelUtilization: avg("channelUtilization"),
        airUtilTx: avg("airUtilTx"),
        uptimeSeconds: avg("uptimeSeconds"),
        temperature: avg("temperature"),
        relativeHumidity: avg("relativeHumidity"),
        barometricPressure: avg("barometricPressure"),
      };
    });

    return result;
  });

  // ── 12. Link Quality Matrix ─────────────────────────────────────────────────
  // Returns average SNR for every node-pair across all packet types.
  // Uses packets (not messages) so NodeInfo, position, telemetry, etc. all
  // contribute — not just text messages.
  // Drives the heatmap: rows/cols = nodes, cell = mean SNR.
  //
  // Query params:
  //   since    – default "7d"
  //   deviceId – filter to one device
  app.get("/api/analytics/link-quality", async (req, _reply) => {
    const { since = "7d", deviceId } = req.query as {
      since?: string;
      deviceId?: string;
    };

    const { where, params } = buildFilters({ since, deviceId });

    const { rows } = await db.query<{
      from_node_id: string;
      to_node_id: string;
      avg_snr: number | null;
      message_count: string;
    }>(
      `
      SELECT
        from_node_id,
        to_node_id,
        AVG(rx_snr)::REAL  AS avg_snr,
        COUNT(*)           AS message_count
      FROM packets
      ${where ? where + " AND rx_snr IS NOT NULL" : "WHERE rx_snr IS NOT NULL"}
      GROUP BY from_node_id, to_node_id
      ORDER BY message_count DESC
      LIMIT 2500
    `,
      params,
    );

    return rows.map((r) => ({
      fromNodeId: Number(r.from_node_id),
      toNodeId: Number(r.to_node_id),
      avgSnr: r.avg_snr ?? null,
      messageCount: Number(r.message_count),
    }));
  });

  // ── 13. Node Activity Timeline ──────────────────────────────────────────────
  // Returns the time range of activity for each node (first/last seen per
  // time bucket), used to render a Gantt-style activity chart.
  //
  // Query params:
  //   since    – default "7d"
  //   bucket   – "hour" | "day" (default "hour")
  //   deviceId – filter to one device
  app.get("/api/analytics/node-activity", async (req, reply) => {
    const {
      since = "7d",
      bucket = "hour",
      deviceId,
    } = req.query as {
      since?: string;
      bucket?: string;
      deviceId?: string;
    };

    if (bucket !== "hour" && bucket !== "day") {
      return reply.status(400).send({ error: "bucket must be 'hour' or 'day'" });
    }

    const { where, params } = buildFilters({ since, deviceId });

    // Count packets per node per time bucket (union messages + packets tables)
    const { rows } = await db.query<{
      ts: string;
      node_id: string;
      count: string;
    }>(
      `
      SELECT
        date_trunc('${bucket}', rx_time) AS ts,
        from_node_id                      AS node_id,
        COUNT(*)                          AS count
      FROM messages
      ${where}
      GROUP BY 1, 2
      UNION ALL
      SELECT
        date_trunc('${bucket}', rx_time) AS ts,
        from_node_id                      AS node_id,
        COUNT(*)                          AS count
      FROM packets
      ${where}
      GROUP BY 1, 2
    `,
      params,
    );

    // Merge the two counts for the same ts+node
    const merged = new Map<string, { ts: string; nodeId: number; count: number }>();
    for (const r of rows) {
      const key = `${r.ts}_${r.node_id}`;
      const existing = merged.get(key);
      if (existing) {
        existing.count += Number(r.count);
      } else {
        merged.set(key, {
          ts: new Date(r.ts).toISOString(),
          nodeId: Number(r.node_id),
          count: Number(r.count),
        });
      }
    }

    return [...merged.values()].sort((a, b) => a.ts.localeCompare(b.ts) || a.nodeId - b.nodeId);
  });

  // ── 14. Neighbor Graph ──────────────────────────────────────────────────────
  // Returns the most recent neighbor list per node, extracted from
  // NEIGHBORINFO_APP decoded_json.  Drives the SNR-coloured network graph.
  //
  // Query params:
  //   since    – default "24h" (use "all" to include all historic data)
  //   deviceId – filter to one device
  app.get("/api/analytics/neighbor-graph", async (req, _reply) => {
    const { since = "24h", deviceId } = req.query as {
      since?: string;
      deviceId?: string;
    };

    const conditions: string[] = ["portnum_name = 'NEIGHBORINFO_APP'", "decoded_json IS NOT NULL"];
    const params: unknown[] = [];

    const sinceDate = parseSince(since);
    if (sinceDate) {
      params.push(sinceDate.toISOString());
      conditions.push(`rx_time >= $${params.length}`);
    }
    if (deviceId) {
      params.push(deviceId);
      conditions.push(`device_id = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    // Most recent NEIGHBORINFO packet per reporting node
    const { rows } = await db.query<{
      from_node_id: string;
      decoded_json: {
        nodeId?: number;
        neighbors?: { nodeId: number; snr?: number }[];
      };
      rx_time: string;
    }>(
      `
      SELECT DISTINCT ON (from_node_id)
        from_node_id,
        decoded_json,
        rx_time
      FROM packets
      ${where}
      ORDER BY from_node_id, rx_time DESC
    `,
      params,
    );

    // Flatten into a list of directed links (one per neighbour relationship)
    const links: { fromNodeId: number; toNodeId: number; snr: number | null; lastSeen: string }[] =
      [];

    for (const row of rows) {
      const fromNodeId = Number(row.from_node_id);
      const neighbors = row.decoded_json?.neighbors ?? [];
      for (const nb of neighbors) {
        if (!nb.nodeId || nb.nodeId === fromNodeId) continue;
        links.push({
          fromNodeId,
          toNodeId: nb.nodeId,
          snr: nb.snr ?? null,
          lastSeen: row.rx_time,
        });
      }
    }

    return links;
  });

  // ── 15. Position History ────────────────────────────────────────────────────
  // Returns recorded GPS fixes from position_history, optionally filtered by
  // node and time range.  Used to render movement trails on the map and a
  // sortable table of all fixes.
  //
  // Query params:
  //   since    – default "24h" (shorthand or ISO)
  //   nodeId   – filter to one specific node (numeric)
  //   deviceId – filter to one device
  //   limit    – max rows to return (default 2000, max 10000)
  app.get("/api/analytics/position-history", async (req, reply) => {
    const {
      since = "24h",
      nodeId,
      deviceId,
      limit: limitStr,
    } = req.query as {
      since?: string;
      nodeId?: string;
      deviceId?: string;
      limit?: string;
    };

    const limit = Math.min(10_000, Math.max(1, parseInt(limitStr ?? "2000", 10) || 2000));

    const conditions: string[] = [];
    const params: unknown[] = [];

    const sinceDate = parseSince(since);
    if (sinceDate) {
      params.push(sinceDate.toISOString());
      conditions.push(`recorded_at >= $${params.length}`);
    }
    if (deviceId) {
      params.push(deviceId);
      conditions.push(`device_id = $${params.length}`);
    }
    if (nodeId) {
      const nid = Number(nodeId);
      if (!Number.isFinite(nid)) return reply.status(400).send({ error: "Invalid nodeId" });
      params.push(nid);
      conditions.push(`node_id = $${params.length}`);
    }

    params.push(limit);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await db.query<{
      id: string;
      node_id: string;
      latitude: number;
      longitude: number;
      altitude: number | null;
      speed: number | null;
      ground_track: number | null;
      sats_in_view: number | null;
      recorded_at: string;
    }>(
      `
      SELECT id, node_id, latitude, longitude, altitude,
             speed, ground_track, sats_in_view, recorded_at
      FROM position_history
      ${where}
      ORDER BY recorded_at DESC
      LIMIT $${params.length}
    `,
      params,
    );

    return rows.map((r) => ({
      id: r.id,
      nodeId: Number(r.node_id),
      latitude: r.latitude,
      longitude: r.longitude,
      altitude: r.altitude,
      speed: r.speed,
      groundTrack: r.ground_track,
      satsInView: r.sats_in_view,
      recordedAt: r.recorded_at,
    }));
  });

  // ── 16. Packet Log ─────────────────────────────────────────────────────────
  // Raw packet rows for the filterable packet log table and CSV export.
  //
  // Query params:
  //   since    – default "24h"
  //   deviceId – filter to one device
  //   portnum  – filter to a portnum_name (e.g. "TEXT_MESSAGE_APP")
  //   limit    – max rows (default 500, max 5000)
  //   offset   – for pagination (default 0)
  //
  // GET /api/analytics/packet-log        → JSON array
  // GET /api/analytics/packet-log.csv    → CSV download

  type PacketLogRow = {
    id: string;
    packet_id: string;
    device_id: string;
    from_node_id: string;
    to_node_id: string;
    portnum_name: string;
    rx_time: string;
    rx_snr: number | null;
    rx_rssi: number | null;
    hop_limit: number | null;
    hop_start: number | null;
    via_mqtt: boolean;
  };

  function buildPacketLogQuery(opts: {
    since?: string;
    deviceId?: string;
    portnum?: string;
    limit: number;
    offset: number;
  }) {
    const { since, deviceId, portnum, limit, offset } = opts;
    const conditions: string[] = [];
    const params: unknown[] = [];

    const sinceDate = parseSince(since);
    if (sinceDate) {
      params.push(sinceDate.toISOString());
      conditions.push(`rx_time >= $${params.length}`);
    }
    if (deviceId) {
      params.push(deviceId);
      conditions.push(`device_id = $${params.length}`);
    }
    if (portnum) {
      params.push(portnum);
      conditions.push(`portnum_name = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    params.push(offset);

    return {
      sql: `
        SELECT id, packet_id, device_id, from_node_id, to_node_id,
               portnum_name, rx_time, rx_snr, rx_rssi,
               hop_limit, hop_start, via_mqtt
        FROM packets
        ${where}
        ORDER BY rx_time DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    };
  }

  app.get("/api/analytics/packet-log", async (req) => {
    const {
      since = "24h",
      deviceId,
      portnum,
      limit: lStr,
      offset: oStr,
    } = req.query as {
      since?: string;
      deviceId?: string;
      portnum?: string;
      limit?: string;
      offset?: string;
    };
    const limit = Math.min(5_000, Math.max(1, parseInt(lStr ?? "500", 10) || 500));
    const offset = Math.max(0, parseInt(oStr ?? "0", 10) || 0);

    const { sql, params } = buildPacketLogQuery({ since, deviceId, portnum, limit, offset });
    const { rows } = await db.query<PacketLogRow>(sql, params);

    return rows.map((r) => ({
      id: r.id,
      packetId: Number(r.packet_id),
      deviceId: r.device_id,
      fromNodeId: Number(r.from_node_id),
      toNodeId: Number(r.to_node_id),
      portnumName: r.portnum_name,
      rxTime: new Date(r.rx_time).toISOString(),
      rxSnr: r.rx_snr ?? null,
      rxRssi: r.rx_rssi ?? null,
      hopLimit: r.hop_limit ?? null,
      hopStart: r.hop_start ?? null,
      viaMqtt: r.via_mqtt,
    }));
  });

  app.get("/api/analytics/packet-log.csv", async (req, reply) => {
    const {
      since = "24h",
      deviceId,
      portnum,
    } = req.query as {
      since?: string;
      deviceId?: string;
      portnum?: string;
    };
    // No pagination for CSV — cap at 50k rows to protect memory
    const { sql, params } = buildPacketLogQuery({
      since,
      deviceId,
      portnum,
      limit: 50_000,
      offset: 0,
    });
    const { rows } = await db.query<PacketLogRow>(sql, params);

    const header =
      "id,packetId,deviceId,fromNodeId,toNodeId,portnumName,rxTime,rxSnr,rxRssi,hopLimit,hopStart,viaMqtt\n";
    const body = rows
      .map((r) =>
        [
          r.id,
          r.packet_id,
          r.device_id,
          r.from_node_id,
          r.to_node_id,
          r.portnum_name,
          new Date(r.rx_time).toISOString(),
          r.rx_snr ?? "",
          r.rx_rssi ?? "",
          r.hop_limit ?? "",
          r.hop_start ?? "",
          r.via_mqtt ? "true" : "false",
        ].join(","),
      )
      .join("\n");

    const filename = `packet-log-${since}.csv`;
    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return header + body;
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LATENCY_BUCKETS = [
  { label: "<1s", maxMs: 1_000 },
  { label: "1-5s", maxMs: 5_000 },
  { label: "5-30s", maxMs: 30_000 },
  { label: "30s-1m", maxMs: 60_000 },
  { label: ">1m", maxMs: Infinity },
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Return the value at the given percentile (0–100) from a sorted array. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}
