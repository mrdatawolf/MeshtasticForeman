import styles from "./popupStyles.module.css";

export { styles };

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export type ActionBtnVariant = "green" | "red";

/**
 * Replacement for the old `popupActionBtnStyle(active)` helper (previously
 * duplicated in NodePopups.tsx and ProposalEditor.tsx). `variant` applies the
 * always-on color override used at a couple of call sites regardless of the
 * `active` (pending/disabled) state.
 */
export function popupActionBtnClass(active: boolean, variant?: ActionBtnVariant): string {
  return cx(
    styles.actionBtn,
    active && styles.actionBtnActive,
    variant === "green" && styles.actionBtnGreen,
    variant === "red" && styles.actionBtnRed,
  );
}
