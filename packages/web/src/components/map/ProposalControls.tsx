import { MODEM_PRESET_LABELS as MODEM_PRESET_LABEL } from "@foreman/shared";

import { MODEM_PRESET_RADIUS_KM } from "./mapCoverageConfig.js";
import { ageFilterBtnClass, cx, statusClass, styles } from "./mapStyles.js";

import type { CoverageProposal } from "@foreman/shared";
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
              className: statusClass(done, total, errors),
              title: "Computing terrain line-of-sight for proposals…",
            };
          return {
            text: errors > 0 ? `⛰ ${errors} failed` : "⛰ ready",
            className: statusClass(done, total, errors),
            title: undefined,
          };
        })();

        return (
          <div className={styles.controlPanel}>
            {/* Always-visible summary row */}
            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Proposals:</span>
              <span className={styles.summaryPill}>
                {proposals.length === 0
                  ? "none"
                  : `${proposals.filter((p) => p.visible).length}/${proposals.length}`}
              </span>
              <button
                className={ageFilterBtnClass(proposalPlanningMode, "amber")}
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
                  className={proposalTerrainStatus.className}
                  title={proposalTerrainStatus.title}
                >
                  {proposalTerrainStatus.text}
                </span>
              )}
              {proposals.length > 0 && (
                <button
                  className={ageFilterBtnClass(proposalsExpanded)}
                  onClick={() => setProposalsExpanded((v) => !v)}
                  title="Show/hide proposal list"
                >
                  {proposalsExpanded ? "▲" : "▼"}
                </button>
              )}
            </div>

            {/* Expanded proposal list */}
            {proposalsExpanded && proposals.length > 0 && (
              <div className={styles.proposalListWrap}>
                {proposals.map((p) => (
                  <div key={p.id} className={styles.proposalRow}>
                    <button
                      className={cx(
                        ageFilterBtnClass(p.visible, "amber"),
                        styles.proposalVisibleBtn,
                      )}
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
                    <span className={styles.proposalName}>{p.name}</span>
                    <span className={styles.proposalMeta}>
                      {MODEM_PRESET_LABEL[p.modemPreset]?.replace(/_/g, " ") ?? `#${p.modemPreset}`}
                    </span>
                    <button
                      className={cx(ageFilterBtnClass(false), styles.dangerBtn)}
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
                  className={cx(ageFilterBtnClass(false), styles.copyAllBtn)}
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
