import { MODEM_PRESET_LABELS as MODEM_PRESET_LABEL } from "@foreman/shared";
import { useState } from "react";

import { MODEM_PRESET_RADIUS_KM } from "./mapCoverageConfig.js";

import type { CoverageProposal } from "@foreman/shared";
import type React from "react";

export function ProposalEditor({
  proposal,
  onUpdate,
  onDelete,
}: {
  proposal: CoverageProposal;
  onUpdate: (updated: CoverageProposal) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(proposal.name);
  const [altitudeM, setAltitudeM] = useState(proposal.altitudeM);
  const [modemPreset, setModemPreset] = useState(proposal.modemPreset);
  const [notes, setNotes] = useState(proposal.notes ?? "");
  const [dirty, setDirty] = useState(false);

  const handleSave = () => {
    onUpdate({
      ...proposal,
      name: name.trim() || proposal.name,
      altitudeM,
      modemPreset,
      notes: notes.trim() || null,
    });
    setDirty(false);
  };

  const handleCopyGeoJSON = () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [proposal.lon, proposal.lat, altitudeM] },
      properties: {
        name: name.trim() || proposal.name,
        altitudeM,
        modemPreset,
        modemPresetLabel: MODEM_PRESET_LABEL[modemPreset] ?? `#${modemPreset}`,
        coverageRadiusKm: MODEM_PRESET_RADIUS_KM[modemPreset] ?? 10,
        notes: notes.trim() || null,
      },
    };
    navigator.clipboard.writeText(JSON.stringify(feature, null, 2)).catch(console.error);
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: "0.25rem",
    padding: "0.2rem 0.4rem",
    fontFamily: "monospace",
    fontSize: "0.75rem",
    color: "#1e293b",
    boxSizing: "border-box",
  };

  return (
    <div style={{ ...popupStyles.popup, minWidth: "220px" }}>
      <div style={{ ...popupStyles.tag, background: "#fef3c7", color: "#92400e" }}>Proposal</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <div>
          <label style={popupStyles.label}>Name</label>
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <div style={{ flex: 1 }}>
            <label style={popupStyles.label}>Altitude (m)</label>
            <input
              style={inputStyle}
              type="number"
              min={0}
              max={9000}
              value={altitudeM}
              onChange={(e) => {
                setAltitudeM(Number(e.target.value));
                setDirty(true);
              }}
            />
          </div>
          <div style={{ flex: 2 }}>
            <label style={popupStyles.label}>Modem Preset</label>
            <select
              style={inputStyle}
              value={modemPreset}
              onChange={(e) => {
                setModemPreset(Number(e.target.value));
                setDirty(true);
              }}
            >
              {Object.entries(MODEM_PRESET_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label style={popupStyles.label}>Notes</label>
          <textarea
            style={{ ...inputStyle, resize: "vertical", minHeight: "2.5rem" }}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div style={{ color: "#64748b", fontSize: "0.65rem", fontFamily: "monospace" }}>
          {proposal.lat.toFixed(5)}, {proposal.lon.toFixed(5)}
          &nbsp;·&nbsp;{MODEM_PRESET_RADIUS_KM[modemPreset] ?? 10}km radius
        </div>
      </div>
      <div style={popupStyles.actions}>
        {dirty && (
          <button style={popupActionBtnStyle(false)} onClick={handleSave}>
            Save Changes
          </button>
        )}
        <button style={popupActionBtnStyle(false)} onClick={handleCopyGeoJSON}>
          Copy GeoJSON
        </button>
        <button
          style={{ ...popupActionBtnStyle(false), borderColor: "#fca5a5", color: "#dc2626" }}
          onClick={onDelete}
        >
          Delete Proposal
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function popupActionBtnStyle(active: boolean): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: active ? "#dbeafe" : "#f1f5f9",
    border: `1px solid ${active ? "#93c5fd" : "#cbd5e1"}`,
    color: active ? "#1d4ed8" : "#334155",
    borderRadius: "0.25rem",
    padding: "0.3rem 0.5rem",
    cursor: active ? "not-allowed" : "pointer",
    fontFamily: "monospace",
    fontSize: "0.75rem",
  };
}

const popupStyles: Record<string, React.CSSProperties> = {
  popup: { minWidth: "200px", fontSize: "0.8rem", color: "#1e293b" },
  name: { fontWeight: "bold", fontSize: "0.9rem", marginBottom: "0.1rem" },
  muted: { color: "#64748b", marginBottom: "0.25rem" },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
    marginTop: "0.6rem",
    paddingTop: "0.5rem",
    borderTop: "1px solid #e2e8f0",
  },
  tag: {
    display: "inline-block",
    background: "#dbeafe",
    color: "#1d4ed8",
    borderRadius: "0.25rem",
    padding: "0 0.35rem",
    fontSize: "0.65rem",
    fontWeight: "bold",
    marginBottom: "0.4rem",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "0.2rem 0.75rem",
    alignItems: "baseline",
  },
  label: { color: "#64748b", fontSize: "0.75rem" },
  mono: { fontFamily: "monospace", fontSize: "0.75rem" },
};
