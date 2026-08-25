import { MODEM_PRESET_LABELS as MODEM_PRESET_LABEL } from "@foreman/shared";
import { useState } from "react";

import { MODEM_PRESET_RADIUS_KM } from "./mapCoverageConfig.js";
import { popupActionBtnClass, styles as popupStyles } from "./popupStyles.js";
import editorStyles from "./ProposalEditor.module.css";

import type { CoverageProposal } from "@foreman/shared";

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

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

  return (
    <div className={cx(popupStyles.popup, editorStyles.popupWide)}>
      <div className={cx(popupStyles.tag, popupStyles.tagAmber)}>Proposal</div>
      <div className={editorStyles.form}>
        <div>
          <label className={popupStyles.label}>Name</label>
          <input
            className={editorStyles.input}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div className={editorStyles.formRow}>
          <div className={editorStyles.formColFlex1}>
            <label className={popupStyles.label}>Altitude (m)</label>
            <input
              className={editorStyles.input}
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
          <div className={editorStyles.formColFlex2}>
            <label className={popupStyles.label}>Modem Preset</label>
            <select
              className={editorStyles.input}
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
          <label className={popupStyles.label}>Notes</label>
          <textarea
            className={cx(editorStyles.input, editorStyles.textarea)}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div className={editorStyles.metaLine}>
          {proposal.lat.toFixed(5)}, {proposal.lon.toFixed(5)}
          &nbsp;·&nbsp;{MODEM_PRESET_RADIUS_KM[modemPreset] ?? 10}km radius
        </div>
      </div>
      <div className={popupStyles.actions}>
        {dirty && (
          <button className={popupActionBtnClass(false)} onClick={handleSave}>
            Save Changes
          </button>
        )}
        <button className={popupActionBtnClass(false)} onClick={handleCopyGeoJSON}>
          Copy GeoJSON
        </button>
        <button className={popupActionBtnClass(false, "red")} onClick={onDelete}>
          Delete Proposal
        </button>
      </div>
    </div>
  );
}
