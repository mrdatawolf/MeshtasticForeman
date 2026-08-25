import styles from "./shellStyles.module.css";

export { styles };

export const KNOWN_TAGS = ["devices", "mqtt", "ws", "db", "foreman"] as const;

/** Per-tag color class, applied to `.hdrFilterBtn` (see hdrFilterActiveWhiteClass). */
export const TAG_COLOR_CLASS: Record<string, string> = {
  devices: styles.tagDevices,
  mqtt: styles.tagMqtt,
  ws: styles.tagWs,
  db: styles.tagDb,
  foreman: styles.tagForeman,
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function tabClass(active: boolean): string {
  return cx(styles.tab, active && styles.tabActive);
}

export function menuBtnClass(open: boolean, connected: boolean): string {
  return cx(
    styles.menuBtn,
    open && styles.menuBtnOpen,
    !connected ? styles.menuBtnBorderDisconnected : open && styles.menuBtnBorderOpen,
  );
}

export function menuNavClass(active: boolean): string {
  return cx(styles.menuNavBtn, active && styles.menuNavBtnActive);
}

export function deviceActionClass(action: "connect" | "disconnect"): string {
  return cx(
    styles.deviceActionBtn,
    action === "connect" ? styles.deviceActionConnect : styles.deviceActionDisconnect,
  );
}

export function hdrFilterClass(active: boolean): string {
  return cx(styles.hdrFilterBtn, active && styles.hdrFilterBtnActive);
}

/**
 * Same base button as hdrFilterClass, but for the call sites that historically
 * overrode the active color to pure white and gave the inactive state its own
 * color (activity source, log level, and log tag filters).
 */
export function hdrFilterActiveWhiteClass(active: boolean, inactiveColorClass?: string): string {
  return cx(styles.hdrFilterBtn, active ? styles.hdrFilterBtnActiveWhite : inactiveColorClass);
}

export function badgeClass(connected: boolean): string {
  return cx(styles.badge, connected ? styles.badgeOn : styles.badgeOff);
}
