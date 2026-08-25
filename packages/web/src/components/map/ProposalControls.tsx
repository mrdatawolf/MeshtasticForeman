import { MODEM_PRESET_LABELS as MODEM_PRESET_LABEL } from "@foreman/shared";

import { MODEM_PRESET_RADIUS_KM } from "./mapCoverageConfig.js";

import type { CoverageProposal } from "@foreman/shared";
import type React from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

type ProposalStatus = "loading" | "ready" | "error";

interface ProposalControlsProps {
  terrainMode: boolean;
  proposals: CoverageProposal[];
  setProposals: Dispatch<SetStateAction<CoverageProposal[]>>;
  proposalViewshedStatus: Map<string, ProposalStatus>;
  setProposalViewshedStatus: Dispatch<SetStateAction<Map<string, ProposalStatus>>>;
  proposalViewshedCache: MutableRefObject<Map<string, GeoJSON.Feature<GeoJSON.Polygon>>>;
  proposalPlanningMode: boolean;
  setProposalPlanningMode: Dispatch<SetStateAction<boolean>>;
  proposalsExpanded: boolean;
  setProposalsExpanded: Dispatch<SetStateAction<boolean>>;
  selectedProposal: CoverageProposal | null;
  setSelectedProposal: Dispatch<SetStateAction<CoverageProposal | null>>;
}

export function ProposalControls({
  terrainMode,
  proposals,
  setProposals,
  proposalViewshedStatus,
  setProposalViewshedStatus,
  proposalViewshedCache,
  proposalPlanningMode,
  setProposalPlanningMode,
  proposalsExpanded,
  setProposalsExpanded,
  selectedProposal,
  setSelectedProposal,
}: ProposalControlsProps) {
  return (
    <>
      {/* ── Proposals panel ───────────────────────────────────────────── */}
      {(() => {
        const proposalTerrainStatus = (() => {
          if (!terrainMode || proposals.length === 0) return null;
          const visible = proposals.filter((p) => p.visible);
          if (visible.length === 0) return null;
          const total = visible.length;
          const done = visible.filter(
            (p) =>
              proposalViewshedStatus.get(p.id) !== "loading" &&
              proposalViewshedCache.current.has(p.id),
          ).length;
          const errors = visible.filter((p) => proposalViewshedStatus.get(p.id) === "error").length;
          if (done < total)
            return {
              text: `⛰ ${done}/${total}`,
              color: "#fbbf24",
              title: "Computing terrain line-of-sight for proposals…",
            };
          return {
            text: errors > 0 ? `⛰ ${errors} failed` : "⛰ ready",
            color: errors > 0 ? "#fca5a5" : "#86efac",
            title: undefined,
          };
        })();

        return (
          <div style={{ ...styles.controlPanel }}>
            {/* Always-visible summary row */}
            <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
              <span style={styles.controlLabel}>Proposals:</span>
              <span style={styles.summaryPill}>
                {proposals.length === 0
                  ? "none"
                  : `${proposals.filter((p) => p.visible).length}/${proposals.length}`}
              </span>
              <button
                style={{
                  ...ageFilterBtnStyle(proposalPlanningMode),
                  ...(proposalPlanningMode
                    ? { borderColor: "#f59e0b", color: "#f59e0b", background: "#422006" }
                    : {}),
                }}
                onClick={() => setProposalPlanningMode((v) => !v)}
                title={
                  proposalPlanningMode
                    ? "Click map to drop proposal pins. Click again to exit."
                    : "Enter planning mode to add proposal pins"
                }
              >
                {proposalPlanningMode ? "✦ Placing…" : "+ Place"}
              </button>
              {proposalTerrainStatus && (
                <span
                  style={{
                    color: proposalTerrainStatus.color,
                    fontSize: "0.7rem",
                    fontFamily: "monospace",
                  }}
                  title={proposalTerrainStatus.title}
                >
                  {proposalTerrainStatus.text}
                </span>
              )}
              {proposals.length > 0 && (
                <button
                  style={ageFilterBtnStyle(proposalsExpanded)}
                  onClick={() => setProposalsExpanded((v) => !v)}
                  title="Show/hide proposal list"
                >
                  {proposalsExpanded ? "▲" : "▼"}
                </button>
              )}
            </div>

            {/* Expanded proposal list */}
            {proposalsExpanded && proposals.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.25rem",
                  paddingTop: "0.15rem",
                  borderTop: "1px solid #1e293b",
                  width: "100%",
                }}
              >
                {proposals.map((p) => (
                  <div key={p.id} style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                    <button
                      style={{
                        ...ageFilterBtnStyle(p.visible),
                        padding: "0.15rem 0.4rem",
                        minWidth: "2.5rem",
                        ...(p.visible
                          ? { borderColor: "#f59e0b", color: "#f59e0b", background: "#422006" }
                          : {}),
                      }}
                      onClick={() => {
                        fetch(`/api/proposals/${p.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ visible: !p.visible }),
                        })
                          .then((r) => r.json())
                          .then((updated: CoverageProposal) =>
                            setProposals((prev) =>
                              prev.map((x) => (x.id === updated.id ? updated : x)),
                            ),
                          )
                          .catch(console.error);
                      }}
                      title={p.visible ? "Hide this proposal" : "Show this proposal"}
                    >
                      {p.visible ? "●" : "○"}
                    </button>
                    <span
                      style={{
                        flex: 1,
                        color: "#cbd5e1",
                        fontSize: "0.7rem",
                        fontFamily: "monospace",
                      }}
                    >
                      {p.name}
                    </span>
                    <span
                      style={{ color: "#64748b", fontSize: "0.65rem", fontFamily: "monospace" }}
                    >
                      {MODEM_PRESET_LABEL[p.modemPreset]?.replace(/_/g, " ") ?? `#${p.modemPreset}`}
                    </span>
                    <button
                      style={{
                        ...ageFilterBtnStyle(false),
                        padding: "0.15rem 0.4rem",
                        color: "#ef4444",
                      }}
                      onClick={() => {
                        fetch(`/api/proposals/${p.id}`, { method: "DELETE" })
                          .then(() => {
                            setProposals((prev) => prev.filter((x) => x.id !== p.id));
                            proposalViewshedCache.current.delete(p.id);
                            setProposalViewshedStatus((prev) => {
                              const m = new Map(prev);
                              m.delete(p.id);
                              return m;
                            });
                            if (selectedProposal?.id === p.id) setSelectedProposal(null);
                          })
                          .catch(console.error);
                      }}
                      title="Delete this proposal"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {/* Copy all proposals as GeoJSON FeatureCollection */}
                <button
                  style={{
                    ...ageFilterBtnStyle(false),
                    marginTop: "0.1rem",
                    textAlign: "center",
                    width: "100%",
                  }}
                  onClick={() => {
                    const fc: GeoJSON.FeatureCollection = {
                      type: "FeatureCollection",
                      features: proposals.map((p) => ({
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [p.lon, p.lat, p.altitudeM] },
                        properties: {
                          name: p.name,
                          altitudeM: p.altitudeM,
                          modemPreset: p.modemPreset,
                          modemPresetLabel:
                            MODEM_PRESET_LABEL[p.modemPreset] ?? `#${p.modemPreset}`,
                          coverageRadiusKm: MODEM_PRESET_RADIUS_KM[p.modemPreset] ?? 10,
                          notes: p.notes,
                        },
                      })),
                    };
                    navigator.clipboard.writeText(JSON.stringify(fc, null, 2)).catch(console.error);
                  }}
                  title="Copy all proposals as GeoJSON FeatureCollection to clipboard"
                >
                  Copy All GeoJSON
                </button>
              </div>
            )}
          </div>
        );
      })()}
    </>
  );
}

function ageFilterBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "0.2rem 0.45rem",
    fontSize: "0.7rem",
    borderRadius: "0.3rem",
    border: active ? "1px solid #60a5fa" : "1px solid #334155",
    background: active ? "#1e3a5f" : "#1e293b",
    color: active ? "#93c5fd" : "#94a3b8",
    cursor: "pointer",
  };
}

const styles: Record<string, React.CSSProperties> = {
  controlPanel: {
    background: "#0f172acc",
    backdropFilter: "blur(4px)",
    color: "#e2e8f0",
    padding: "0.4rem 0.6rem",
    borderRadius: "0.5rem",
    fontSize: "0.75rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    alignItems: "flex-start",
  },
  summaryPill: {
    fontSize: "0.7rem",
    color: "#cbd5e1",
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "0.3rem",
    padding: "0.15rem 0.45rem",
    fontFamily: "monospace",
  },
  controlLabel: { color: "#94a3b8", marginRight: "0.15rem", fontSize: "0.7rem" },
};
