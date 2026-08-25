/** Parse a shorthand or ISO `since` value. Invalid, omitted, and `all` values mean no filter. */
export function parseSince(since: string | undefined): Date | null {
  if (!since || since === "all") return null;
  const shorthand = since.match(/^(\d+)(h|d)$/);
  if (shorthand) {
    const n = parseInt(shorthand[1], 10);
    const ms = shorthand[2] === "h" ? n * 3_600_000 : n * 86_400_000;
    return new Date(Date.now() - ms);
  }
  const ts = new Date(since);
  return isNaN(ts.getTime()) ? null : ts;
}

export function buildFilters(opts: { since?: string; deviceId?: string; timeCol?: string }): {
  where: string;
  params: unknown[];
} {
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
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}
