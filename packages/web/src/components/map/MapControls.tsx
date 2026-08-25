import { MODEM_PRESET_LABELS as MODEM_PRESET_LABEL } from "@foreman/shared";

import {
  COVERAGE_RADII_KM,
  DEFAULT_RADIUS_KM,
  MODEM_PRESET_RADIUS_KM,
} from "./mapCoverageConfig.js";

import type { DeviceConfig } from "@foreman/shared";
import type React from "react";
import type { Dispatch, SetStateAction } from "react";

interface MapControlsProps {
  deviceId?: string | null;
  deviceConfigs?: Map<string, DeviceConfig>;
  presetFilter: number | null;
  setPresetFilter?: (value: number | null) => void;
  availablePresets: number[];
  coverageRadiusKm: number;
  setCoverageRadiusKm: Dispatch<SetStateAction<number>>;
  setUserPickedRadius: Dispatch<SetStateAction<boolean>>;
  showCoverage: boolean;
  setShowCoverage: Dispatch<SetStateAction<boolean>>;
  terrainMode: boolean;
  setTerrainMode: Dispatch<SetStateAction<boolean>>;
  coverageUnion: boolean;
  setCoverageUnion: Dispatch<SetStateAction<boolean>>;
  coverageExpanded: boolean;
  setCoverageExpanded: Dispatch<SetStateAction<boolean>>;
  coverageMqtt: boolean;
  setCoverageMqtt: Dispatch<SetStateAction<boolean>>;
  showMqtt: boolean;
  effectiveFocusedNodeId: number | null;
  effectiveFocusedNodeName: string | null;
  setLocalFocusedNodeId: Dispatch<SetStateAction<number | null>>;
  onClearFocusedNode?: () => void;
  viewshedStatus: Map<number, "loading" | "ready" | "error">;
}

export function MapControls({
  deviceId,
  deviceConfigs,
  presetFilter,
  setPresetFilter,
  availablePresets,
  coverageRadiusKm,
  setCoverageRadiusKm,
  setUserPickedRadius,
  showCoverage,
  setShowCoverage,
  terrainMode,
  setTerrainMode,
  coverageUnion,
  setCoverageUnion,
  coverageExpanded,
  setCoverageExpanded,
  coverageMqtt,
  setCoverageMqtt,
  showMqtt,
  effectiveFocusedNodeId,
  effectiveFocusedNodeName,
  setLocalFocusedNodeId,
  onClearFocusedNode,
  viewshedStatus,
}: MapControlsProps) {
  return (
    <>
      {/* ── Coverage panel ───────────────────────────────────────────── */}
      {(() => {
        const devicePreset = (() => {
          if (!deviceId || !deviceConfigs) return null;
          const cfg = deviceConfigs.get(deviceId);
          return (
            (cfg?.radioConfig as { lora?: { modemPreset?: number } } | undefined)?.lora
              ?.modemPreset ?? null
          );
        })();
        const summaryPreset = presetFilter !== null ? presetFilter : devicePreset;
        const summaryPresetLabel =
          summaryPreset != null
            ? (MODEM_PRESET_LABEL[summaryPreset] ?? `#${summaryPreset}`)
            : availablePresets.length > 1
              ? "All presets"
              : "—";
        const summaryRangeLabel =
          presetFilter !== null
            ? `${coverageRadiusKm}km`
            : summaryPreset != null
              ? `${MODEM_PRESET_RADIUS_KM[summaryPreset] ?? DEFAULT_RADIUS_KM}km`
              : "auto";

        const terrainStatus = (() => {
          if (!showCoverage || !terrainMode) return null;
          const total = viewshedStatus.size;
          if (total === 0) return null;
          const done = [...viewshedStatus.values()].filter((s) => s !== "loading").length;
          const errors = [...viewshedStatus.values()].filter((s) => s === "error").length;
          if (done < total)
            return {
              text: `⛰ ${done}/${total}`,
              color: "#fbbf24",
              title: "Computing terrain line-of-sight…",
            };
          return {
            text: errors > 0 ? `⛰ ${errors} failed` : "⛰ ready",
            color: errors > 0 ? "#fca5a5" : "#86efac",
            title: undefined,
          };
        })();

        const rowStyle: React.CSSProperties = {
          display: "flex",
          gap: "0.3rem",
          alignItems: "center",
        };

        return (
          <div style={{ ...styles.controlPanel }}>
            {/* Simple row — always visible */}
            <div style={rowStyle}>
              <span style={styles.controlLabel}>Coverage:</span>

              <span style={styles.summaryPill}>
                {summaryPresetLabel} · {summaryRangeLabel}
              </span>

              <button
                style={{
                  ...ageFilterBtnStyle(terrainMode),
                  ...(terrainMode
                    ? { borderColor: "#86efac", color: "#86efac", background: "#14532d" }
                    : {}),
                }}
                onClick={() => setTerrainMode((v) => !v)}
                title={
                  terrainMode
                    ? "Switch to simple circle coverage"
                    : "Switch to terrain-aware coverage (fetches elevation data)"
                }
              >
                {terrainMode ? "Terrain" : "Simple"}
              </button>

              <button
                style={{
                  ...ageFilterBtnStyle(coverageUnion),
                  ...(coverageUnion
                    ? { borderColor: "#a78bfa", color: "#a78bfa", background: "#2e1065" }
                    : {}),
                }}
                onClick={() => setCoverageUnion((v) => !v)}
                title={
                  coverageUnion
                    ? "Switch to separate fills (each node draws its own circle)"
                    : "Switch to union fill (overlapping areas merge into one shape)"
                }
              >
                {coverageUnion ? "Union" : "Separate"}
              </button>

              <button
                style={{
                  ...ageFilterBtnStyle(showCoverage),
                  ...(showCoverage ? {} : { color: "#64748b" }),
                }}
                onClick={() => setShowCoverage((v) => !v)}
                title={showCoverage ? "Hide coverage overlay" : "Show coverage overlay"}
              >
                {showCoverage ? "On" : "Off"}
              </button>

              <button
                style={{ ...ageFilterBtnStyle(coverageExpanded), padding: "0.2rem 0.35rem" }}
                onClick={() => setCoverageExpanded((v) => !v)}
                title={
                  coverageExpanded
                    ? "Hide advanced coverage options"
                    : "Show advanced coverage options"
                }
              >
                {coverageExpanded ? "▲" : "▼"}
              </button>

              {effectiveFocusedNodeId != null && (
                <>
                  <button
                    style={{
                      ...ageFilterBtnStyle(false),
                      borderColor: "#86efac",
                      color: "#86efac",
                    }}
                    onClick={() => {
                      setLocalFocusedNodeId(null);
                      onClearFocusedNode?.();
                    }}
                    title="Return to all-nodes coverage view"
                  >
                    ← All nodes
                  </button>
                  {effectiveFocusedNodeName && (
                    <span
                      style={{
                        color: "#86efac",
                        fontSize: "0.7rem",
                        fontFamily: "monospace",
                        maxWidth: "10rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {effectiveFocusedNodeName}
                    </span>
                  )}
                </>
              )}

              {terrainStatus && (
                <span
                  style={{
                    color: terrainStatus.color,
                    fontSize: "0.7rem",
                    fontFamily: "monospace",
                  }}
                  title={terrainStatus.title}
                >
                  {terrainStatus.text}
                </span>
              )}
            </div>

            {/* Advanced row — shown when expanded */}
            {coverageExpanded && (
              <div
                style={{
                  ...rowStyle,
                  flexWrap: "wrap",
                  paddingTop: "0.15rem",
                  borderTop: "1px solid #1e293b",
                }}
              >
                <span style={{ ...styles.controlLabel, marginRight: 0 }}>Preset:</span>

                <button
                  style={ageFilterBtnStyle(presetFilter === null)}
                  onClick={() => setPresetFilter?.(null)}
                  title="Show all presets at their own default range"
                >
                  All
                </button>

                {availablePresets.map((p) => (
                  <button
                    key={p}
                    style={ageFilterBtnStyle(presetFilter === p)}
                    onClick={() => {
                      const next = presetFilter === p ? null : p;
                      setPresetFilter?.(next);
                      if (next !== null) {
                        setCoverageRadiusKm(MODEM_PRESET_RADIUS_KM[next] ?? DEFAULT_RADIUS_KM);
                        setUserPickedRadius(false);
                      }
                    }}
                    title={`${MODEM_PRESET_LABEL[p] ?? `#${p}`} — default range ${MODEM_PRESET_RADIUS_KM[p] ?? DEFAULT_RADIUS_KM}km`}
                  >
                    {MODEM_PRESET_LABEL[p] ?? `#${p}`}
                  </button>
                ))}

                {presetFilter !== null && (
                  <>
                    <span style={{ color: "#475569", margin: "0 0.1rem", fontSize: "0.8rem" }}>
                      |
                    </span>
                    <span style={{ ...styles.controlLabel, marginRight: 0 }}>Range:</span>
                    {COVERAGE_RADII_KM.map((km) => (
                      <button
                        key={km}
                        style={ageFilterBtnStyle(coverageRadiusKm === km)}
                        onClick={() => {
                          setCoverageRadiusKm(km);
                          setUserPickedRadius(true);
                        }}
                        title={`Set coverage radius to ${km} km`}
                      >
                        {km}km
                      </button>
                    ))}
                  </>
                )}

                {showMqtt && (
                  <>
                    <span style={{ color: "#475569", margin: "0 0.1rem", fontSize: "0.8rem" }}>
                      |
                    </span>
                    <button
                      style={{
                        ...ageFilterBtnStyle(coverageMqtt),
                        ...(coverageMqtt
                          ? { borderColor: "#34d399", color: "#34d399", background: "#052e16" }
                          : {}),
                      }}
                      onClick={() => setCoverageMqtt((v) => !v)}
                      title={
                        coverageMqtt
                          ? "Hide MQTT node coverage"
                          : "Include MQTT nodes in coverage overlay"
                      }
                    >
                      {coverageMqtt ? "−MQTT" : "+MQTT"}
                    </button>
                  </>
                )}
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
