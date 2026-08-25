import { ROLES } from "./configConstants.js";
import { navBtnClass, wizardRoleBtnClass, wizardStyles } from "./configStyles.js";
import styles from "./RoleStep.module.css";

export function RoleStep({
  role,
  setRole,
  onNext,
}: {
  role: number | null;
  setRole: (r: number) => void;
  onNext: () => void;
}) {
  return (
    <div className={wizardStyles.step}>
      <div className={wizardStyles.stepTitle}>What is this device?</div>
      <div className={wizardStyles.stepSub}>
        Sets the device role. This affects how it behaves on the mesh.
      </div>
      <div className={styles.grid}>
        {ROLES.map((r) => (
          <button
            key={r.value}
            className={wizardRoleBtnClass(role === r.value)}
            onClick={() => setRole(r.value)}
          >
            <span className={styles.label}>{r.label}</span>
            <span className={styles.sub}>{r.sub}</span>
          </button>
        ))}
      </div>
      <div className={wizardStyles.nav}>
        <span />
        <button className={navBtnClass(role === null)} disabled={role === null} onClick={onNext}>
          Next →
        </button>
      </div>
    </div>
  );
}
