import { useMemo } from "react";

import { camelToLabel } from "./configConstants.js";
import { applyBtnClass, namespacePillClass, navBtnClass, wizardStyles } from "./configStyles.js";
import styles from "./ReviewStep.module.css";

import type { ConfigChange } from "../../lib/setupWizardOutput.js";

export function ReviewStep({
  changes,
  applying,
  applied,
  applyError,
  onBack,
  onApply,
  onClose,
}: {
  changes: ConfigChange[];
  applying: boolean;
  applied: boolean;
  applyError: boolean;
  onBack: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const grouped = useMemo(() => {
    const out: Record<string, { namespace: string; entries: [string, unknown][] }> = {};
    for (const ch of changes) {
      const key = `${ch.namespace}.${ch.section}`;
      out[key] = { namespace: ch.namespace, entries: Object.entries(ch.value) };
    }
    return out;
  }, [changes]);

  if (applied) {
    return (
      <div className={styles.stepCenteredApplied}>
        <div className={styles.checkmark}>✓</div>
        <div className={styles.appliedTitle}>Config applied</div>
        <div className={styles.appliedSub}>
          The device will take a moment to confirm each change.
        </div>
        <button className={navBtnClass(false)} onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  if (changes.length === 0) {
    return (
      <div className={styles.stepCenteredEmpty}>
        <div className={styles.emptyMessage}>
          No changes selected. Go back and choose a role, region, or feature.
        </div>
        <div className={wizardStyles.nav}>
          <button className={navBtnClass(false)} onClick={onBack}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={wizardStyles.step}>
      <div className={wizardStyles.stepTitle}>Review changes</div>
      <div className={wizardStyles.stepSub}>
        These settings will be written to the device. Review before applying.
      </div>

      {applyError && (
        <div className={styles.statusBannerError}>
          Apply failed — check device connection and try again
        </div>
      )}

      <div className={styles.changesList}>
        {Object.entries(grouped).map(([key, { namespace, entries }]) => (
          <div key={key} className={styles.changeCard}>
            <div className={styles.changeCardHeader}>
              <span className={styles.changeSectionKey}>{key.split(".")[1]}</span>
              <span className={namespacePillClass(namespace as "radio" | "module")}>
                {namespace}
              </span>
            </div>
            <div className={styles.changeCardBody}>
              {entries.map(([k, v]) => (
                <div key={k} className={styles.changeRow}>
                  <span className={styles.changeKey}>{camelToLabel(k)}</span>
                  <span className={styles.changeVal}>{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={wizardStyles.nav}>
        <button className={navBtnClass(false)} onClick={onBack}>
          ← Back
        </button>
        <button className={applyBtnClass(applying)} disabled={applying} onClick={onApply}>
          {applying ? "Applying…" : "Apply to device"}
        </button>
      </div>
    </div>
  );
}
