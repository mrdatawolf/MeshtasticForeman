import {
  navBtnClass,
  wizardBreadcrumbBtnClass,
  wizardRegionBtnClass,
  wizardStyles,
} from "./configStyles.js";
import styles from "./RegionStep.module.css";

import type { RegionNode, RegionPresets } from "../../lib/regionMerge.js";

export function RegionStep({
  presets,
  selectedRegions,
  setSelectedRegions,
  onBack,
  onNext,
}: {
  presets: RegionPresets | null;
  selectedRegions: RegionNode[];
  setSelectedRegions: (regions: RegionNode[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const topLevel = presets?.regions ?? [];
  const selectedLeaf = selectedRegions.at(-1) ?? null;
  const columns: { title: string; options: RegionNode[]; level: number; optional: boolean }[] = [];

  if (topLevel.length > 0) {
    columns.push({
      title: "Region",
      options: topLevel,
      level: 0,
      optional: false,
    });
  }

  selectedRegions.forEach((region, index) => {
    if ((region.children?.length ?? 0) > 0) {
      columns.push({
        title: `Specific area within ${region.label}`,
        options: region.children ?? [],
        level: index + 1,
        optional: true,
      });
    }
  });

  function selectRegion(level: number, region: RegionNode) {
    setSelectedRegions([...selectedRegions.slice(0, level), region]);
  }

  return (
    <div className={wizardStyles.step}>
      <div className={wizardStyles.stepTitle}>Where is this device?</div>
      <div className={wizardStyles.stepSub}>
        Sets the LoRa region, modem preset, and MQTT defaults for your area.
      </div>

      {presets === null ? (
        <div className={wizardStyles.stepEmpty}>Loading region presets…</div>
      ) : columns.length === 0 ? (
        <div className={wizardStyles.stepEmpty}>No region presets are available.</div>
      ) : (
        <>
          {selectedRegions.length > 0 && (
            <div className={wizardStyles.breadcrumbs}>
              {selectedRegions.map((region, index) => (
                <button
                  key={region.id}
                  className={wizardBreadcrumbBtnClass(index === selectedRegions.length - 1)}
                  onClick={() => setSelectedRegions(selectedRegions.slice(0, index + 1))}
                >
                  {region.label}
                </button>
              ))}
            </div>
          )}

          {columns.map((column) => (
            <div key={`${column.title}-${column.level}`} className={styles.column}>
              <div className={styles.columnTitle}>
                {column.title}
                {column.optional ? " (optional)" : ""}
              </div>
              <div className={styles.optionsGrid}>
                {column.options.map((region) => {
                  const active = selectedRegions[column.level]?.id === region.id;
                  return (
                    <button
                      key={region.id}
                      className={wizardRegionBtnClass(active, column.level > 0)}
                      onClick={() => selectRegion(column.level, region)}
                    >
                      <span className={styles.regionLabel}>{region.label}</span>
                      {region.description && (
                        <span className={styles.regionDesc}>{region.description}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {selectedLeaf?.children?.length === 0 && (
            <div className={wizardStyles.selectionHint}>
              {selectedLeaf
                ? `Selected: ${selectedRegions.map((region) => region.label).join(" / ")}`
                : ""}
            </div>
          )}
        </>
      )}

      <div className={wizardStyles.nav}>
        <button className={navBtnClass(false)} onClick={onBack}>
          ← Back
        </button>
        <button
          className={navBtnClass(selectedRegions.length === 0)}
          disabled={selectedRegions.length === 0}
          onClick={onNext}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
