import styles from "./NotRespondingIndicator.module.css";

import type { DeviceInfo } from "@foreman/shared";

interface Props {
  devices: DeviceInfo[];
  onOpenDebug: () => void;
}

/** Keeps a hung radio visible on every page, without opening the device menu. */
export function NotRespondingIndicator({ devices, onOpenDebug }: Props) {
  const names = devices.filter((device) => device.notResponding).map((device) => device.name);
  if (names.length === 0) return null;

  return (
    <span role="alert" className={styles.alert}>
      <button
        className={styles.indicator}
        title="Open the Debug page to diagnose this"
        onClick={onOpenDebug}
      >
        Not responding: {names.join(", ")}
      </button>
    </span>
  );
}
