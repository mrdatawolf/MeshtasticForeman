import { useState } from "react";

import type { NodeOverride } from "@foreman/shared";

// Parse "!21058787" or "554010503" into a node number
function parseNodeId(raw: string): number | null {
  const s = raw.trim();
  if (s.startsWith("!")) {
    const n = parseInt(s.slice(1), 16);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nodeHex(nodeId: number): string {
  return `!${nodeId.toString(16).padStart(8, "0")}`;
}

const API = "/api/node-overrides";

interface NoLocationNode {
  nodeId: number;
  longName: string | null;
  shortName: string | null;
}

interface Props {
  overrides: NodeOverride[];
  noLocationNodes: NoLocationNode[];
  onChanged: () => void;
}

const EMPTY_FORM = {
  rawId: "",
  aliasName: "",
  latitude: "",
  longitude: "",
  altitude: "",
  notes: "",
};

export function NodeOverridesPage({ overrides, noLocationNodes, onChanged }: Props) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function startEdit(o: NodeOverride) {
    setEditing(o.nodeId);
    setForm({
      rawId: nodeHex(o.nodeId),
      aliasName: o.aliasName ?? "",
      latitude: o.latitude != null ? String(o.latitude) : "",
      longitude: o.longitude != null ? String(o.longitude) : "",
      altitude: o.altitude != null ? String(o.altitude) : "",
      notes: o.notes ?? "",
    });
    setError(null);
  }

  function cancelEdit() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  async function save() {
    const nodeId = editing ?? parseNodeId(form.rawId);
    if (!nodeId) {
      setError("Invalid node ID — use !hex (e.g. !21058787) or a decimal number");
      return;
    }

    const lat = form.latitude !== "" ? parseFloat(form.latitude) : null;
    const lon = form.longitude !== "" ? parseFloat(form.longitude) : null;
    const alt = form.altitude !== "" ? parseInt(form.altitude, 10) : null;

    if (lat !== null && (isNaN(lat) || lat < -90 || lat > 90)) {
      setError("Latitude must be between -90 and 90");
      return;
    }
    if (lon !== null && (isNaN(lon) || lon < -180 || lon > 180)) {
      setError("Longitude must be between -180 and 180");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/${nodeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aliasName: form.aliasName || null,
          latitude: lat,
          longitude: lon,
          altitude: alt,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditing(null);
      setForm(EMPTY_FORM);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(nodeId: number) {
    await fetch(`${API}/${nodeId}`, { method: "DELETE" });
    onChanged();
  }

  const isAddingNew = editing === null;

  return (
    <div style={s.page}>
      <div style={s.intro}>
        <strong>Node Overrides</strong> — assign a fallback name or location to any node that
        doesn&apos;t broadcast its own. Used for display only; nothing is sent to the mesh or MQTT.
      </div>

      {/* Nodes without location */}
      {noLocationNodes.length > 0 && (
        <div style={s.card}>
          <div style={s.cardTitle}>
            Nodes without location
            <span style={s.candidateCount}>{noLocationNodes.length}</span>
          </div>
          <div style={s.candidateHint}>Click a row to pre-fill the form below.</div>
          <div style={s.candidateList}>
            {noLocationNodes.map((n) => (
              <button
                key={n.nodeId}
                style={s.candidateRow}
                onClick={() => {
                  setEditing(null);
                  setForm({
                    rawId: nodeHex(n.nodeId),
                    aliasName: n.longName ?? n.shortName ?? "",
                    latitude: "",
                    longitude: "",
                    altitude: "",
                    notes: "",
                  });
                  setError(null);
                }}
              >
                <span style={s.candidateHex}>{nodeHex(n.nodeId)}</span>
                <span style={s.candidateName}>
                  {n.longName ?? n.shortName ?? <span style={s.muted}>unnamed</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Form */}
      <div style={s.card}>
        <div style={s.cardTitle}>{isAddingNew ? "Add override" : `Edit ${nodeHex(editing!)}`}</div>

        {error && <div style={s.errorBox}>{error}</div>}

        <div style={s.grid}>
          <label style={s.label}>Node ID</label>
          <input
            style={{ ...s.input, ...(isAddingNew ? {} : s.inputDisabled) }}
            value={form.rawId}
            readOnly={!isAddingNew}
            placeholder="!21058787 or 554010503"
            onChange={(e) => setForm((f) => ({ ...f, rawId: e.target.value }))}
          />

          <label style={s.label}>Alias name</label>
          <input
            style={s.input}
            value={form.aliasName}
            placeholder="Gov Relay (optional)"
            onChange={(e) => setForm((f) => ({ ...f, aliasName: e.target.value }))}
          />

          <label style={s.label}>Latitude</label>
          <input
            style={s.input}
            type="number"
            step="any"
            value={form.latitude}
            placeholder="40.80123 (optional)"
            onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
          />

          <label style={s.label}>Longitude</label>
          <input
            style={s.input}
            type="number"
            step="any"
            value={form.longitude}
            placeholder="-124.16780 (optional)"
            onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
          />

          <label style={s.label}>Altitude (m)</label>
          <input
            style={s.input}
            type="number"
            value={form.altitude}
            placeholder="optional"
            onChange={(e) => setForm((f) => ({ ...f, altitude: e.target.value }))}
          />

          <label style={s.label}>Notes</label>
          <input
            style={s.input}
            value={form.notes}
            placeholder="optional notes"
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>

        <div style={s.btnRow}>
          <button style={s.btnPrimary} onClick={save} disabled={saving}>
            {saving ? "Saving…" : isAddingNew ? "Add" : "Save"}
          </button>
          {!isAddingNew && (
            <button style={s.btnSecondary} onClick={cancelEdit}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {overrides.length === 0 ? (
        <div style={s.empty}>No overrides configured yet.</div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Node ID</th>
              <th style={s.th}>Alias</th>
              <th style={s.th}>Latitude</th>
              <th style={s.th}>Longitude</th>
              <th style={s.th}>Alt</th>
              <th style={s.th}>Notes</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {overrides.map((o) => (
              <tr key={o.nodeId} style={s.tr}>
                <td style={{ ...s.td, ...s.mono }}>{nodeHex(o.nodeId)}</td>
                <td style={s.td}>{o.aliasName ?? <span style={s.muted}>—</span>}</td>
                <td style={{ ...s.td, ...s.mono }}>
                  {o.latitude ?? <span style={s.muted}>—</span>}
                </td>
                <td style={{ ...s.td, ...s.mono }}>
                  {o.longitude ?? <span style={s.muted}>—</span>}
                </td>
                <td style={{ ...s.td, ...s.mono }}>
                  {o.altitude ?? <span style={s.muted}>—</span>}
                </td>
                <td style={s.td}>{o.notes ?? <span style={s.muted}>—</span>}</td>
                <td style={s.td}>
                  <button style={s.btnEdit} onClick={() => startEdit(o)}>
                    edit
                  </button>
                  <button style={s.btnDelete} onClick={() => remove(o.nodeId)}>
                    del
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: "1.5rem 2rem", overflowY: "auto", maxWidth: "90%" },
  intro: { fontSize: "0.85rem", color: "#94a3b8", marginBottom: "1.5rem", lineHeight: 1.6 },
  card: {
    background: "#1e293b",
    borderRadius: "0.5rem",
    padding: "1.25rem",
    marginBottom: "1.5rem",
  },
  cardTitle: { fontWeight: "bold", marginBottom: "1rem", color: "#f1f5f9" },
  errorBox: {
    background: "#450a0a",
    border: "1px solid #7f1d1d",
    borderRadius: "0.375rem",
    padding: "0.5rem 0.75rem",
    marginBottom: "0.75rem",
    color: "#fca5a5",
    fontSize: "0.8rem",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "140px 1fr",
    gap: "0.5rem 1rem",
    alignItems: "center",
    marginBottom: "1rem",
  },
  label: { color: "#94a3b8", fontSize: "0.8rem", textAlign: "right" as const },
  input: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "0.375rem",
    color: "#e2e8f0",
    padding: "0.35rem 0.6rem",
    fontFamily: "monospace",
    fontSize: "0.85rem",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  inputDisabled: { opacity: 0.5 },
  btnRow: { display: "flex", gap: "0.5rem" },
  btnPrimary: {
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: "0.375rem",
    padding: "0.35rem 1rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.85rem",
  },
  btnSecondary: {
    background: "transparent",
    color: "#94a3b8",
    border: "1px solid #334155",
    borderRadius: "0.375rem",
    padding: "0.35rem 1rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.85rem",
  },
  empty: { color: "#64748b", fontSize: "0.85rem" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.825rem" },
  th: {
    textAlign: "left",
    padding: "0.4rem 0.75rem",
    background: "#1e293b",
    color: "#94a3b8",
    fontWeight: "normal",
    borderBottom: "1px solid #334155",
  },
  tr: { borderBottom: "1px solid #1e293b" },
  td: { padding: "0.4rem 0.75rem", verticalAlign: "middle" },
  mono: { fontFamily: "monospace", fontSize: "0.78rem", color: "#94a3b8" },
  muted: { color: "#475569" },
  btnEdit: {
    background: "transparent",
    color: "#60a5fa",
    border: "none",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.78rem",
    padding: "0 0.4rem",
  },
  btnDelete: {
    background: "transparent",
    color: "#f87171",
    border: "none",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.78rem",
    padding: "0 0.4rem",
  },
  candidateCount: {
    background: "#334155",
    borderRadius: "9999px",
    padding: "0.1rem 0.5rem",
    fontSize: "0.7rem",
    marginLeft: "0.6rem",
    color: "#94a3b8",
    fontWeight: "normal",
  },
  candidateHint: { fontSize: "0.78rem", color: "#64748b", marginBottom: "0.6rem" },
  candidateList: { display: "flex", flexWrap: "wrap" as const, gap: "0.4rem" },
  candidateRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "0.375rem",
    padding: "0.3rem 0.75rem",
    cursor: "pointer",
    textAlign: "left" as const,
    fontFamily: "monospace",
    color: "#e2e8f0",
  },
  candidateHex: { fontSize: "0.75rem", color: "#60a5fa" },
  candidateName: { fontSize: "0.8rem", color: "#cbd5e1" },
};
