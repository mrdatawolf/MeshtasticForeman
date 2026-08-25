import styles from "./analyticsStyles.module.css";

export { styles };

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** Replacement for the old `rangeStyle(active)` CSSProperties-returning helper. */
export function rangeBtnClass(active: boolean): string {
  return cx(styles.rangeBtn, active && styles.rangeBtnActive);
}
