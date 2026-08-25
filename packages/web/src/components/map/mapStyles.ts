import styles from "./mapStyles.module.css";

export { styles };

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export type ToggleVariant = "green" | "purple" | "teal" | "amber";

/**
 * Replacement for the old `ageFilterBtnStyle(active)` helper (previously
 * duplicated in MapPage.tsx, MapControls.tsx, and ProposalControls.tsx).
 * `variant` applies one of the color overrides that were previously spread
 * on top of the active style at specific call sites (terrain=green,
 * union=purple, mqtt=teal, planning/visible=amber).
 */
export function ageFilterBtnClass(active: boolean, variant?: ToggleVariant): string {
  return cx(
    styles.ageFilterBtn,
    active && styles.ageFilterBtnActive,
    active && variant === "green" && styles.toggleGreen,
    active && variant === "purple" && styles.togglePurple,
    active && variant === "teal" && styles.toggleTeal,
    active && variant === "amber" && styles.toggleAmber,
  );
}

/** Same base button, but the inactive/"off" state gets a muted text color (traceroute/coverage On/Off). */
export function onOffBtnClass(active: boolean): string {
  return cx(
    styles.ageFilterBtn,
    active && styles.ageFilterBtnActive,
    !active && styles.ageFilterBtnOff,
  );
}

/** Terrain-viewshed status text ("⛰ n/m" / "⛰ ready" / "⛰ n failed"). */
export function statusClass(done: number, total: number, errors: number): string {
  return cx(
    styles.statusText,
    done < total ? styles.statusPending : errors > 0 ? styles.statusError : styles.statusOk,
  );
}
