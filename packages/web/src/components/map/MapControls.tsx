import { MODEM_PRESET_LABELS as MODEM_PRESET_LABEL } from "@foreman/shared";

import {
  COVERAGE_RADII_KM,
  DEFAULT_RADIUS_KM,
  MODEM_PRESET_RADIUS_KM,
} from "./mapCoverageConfig.js";
import { ageFilterBtnClass, cx, onOffBtnClass, statusClass, styles } from "./mapStyles.js";

import type { DeviceConfig } from "@foreman/shared";
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
              className: statusClass(done, total, errors),
              title: "Computing terrain line-of-sight…",
            };
          return {
            text: errors > 0 ? `⛰ ${errors} failed` : "⛰ ready",
            className: statusClass(done, total, errors),
            title: undefined,
          };
        })();

        return (
          <div className={styles.controlPanel}>
            {/* Simple row — always visible */}
            <div className={styles.controlRow}>
              <span className={styles.controlLabel}>Coverage:</span>

              <span className={styles.summaryPill}>
                {summaryPresetLabel} · {summaryRangeLabel}
              </span>

              <button
                className={ageFilterBtnClass(terrainMode, "green")}
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
                className={ageFilterBtnClass(coverageUnion, "purple")}
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
                className={onOffBtnClass(showCoverage)}
                onClick={() => setShowCoverage((v) => !v)}
                title={showCoverage ? "Hide coverage overlay" : "Show coverage overlay"}
              >
                {showCoverage ? "On" : "Off"}
              </button>

              <button
                className={cx(ageFilterBtnClass(coverageExpanded), styles.ageFilterBtnCaret)}
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
                    className={cx(styles.ageFilterBtn, styles.focusedNodeBtn)}
                    onClick={() => {
                      setLocalFocusedNodeId(null);
                      onClearFocusedNode?.();
                    }}
                    title="Return to all-nodes coverage view"
                  >
                    ← All nodes
                  </button>
                  {effectiveFocusedNodeName && (
                    <span className={styles.focusedNodeName}>{effectiveFocusedNodeName}</span>
                  )}
                </>
              )}

              {terrainStatus && (
                <span className={terrainStatus.className} title={terrainStatus.title}>
                  {terrainStatus.text}
                </span>
              )}
            </div>

            {/* Advanced row — shown when expanded */}
            {coverageExpanded && (
              <div className={cx(styles.controlRow, styles.advancedRow)}>
                <span className={cx(styles.controlLabel, styles.controlLabelFlush)}>Preset:</span>

                <button
                  className={ageFilterBtnClass(presetFilter === null)}
                  onClick={() => setPresetFilter?.(null)}
                  title="Show all presets at their own default range"
                >
                  All
                </button>

                {availablePresets.map((p) => (
                  <button
                    key={p}
                    className={ageFilterBtnClass(presetFilter === p)}
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
                    <span className={styles.divider}>|</span>
                    <span className={cx(styles.controlLabel, styles.controlLabelFlush)}>
                      Range:
                    </span>
                    {COVERAGE_RADII_KM.map((km) => (
                      <button
                        key={km}
                        className={ageFilterBtnClass(coverageRadiusKm === km)}
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
                    <span className={styles.divider}>|</span>
                    <button
                      className={ageFilterBtnClass(coverageMqtt, "teal")}
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
