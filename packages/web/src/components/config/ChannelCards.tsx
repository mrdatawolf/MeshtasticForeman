import styles from "./ChannelCards.module.css";
import { CHANNEL_ROLE } from "./configConstants.js";
import { channelCardClass, cx } from "./configStyles.js";

import type { Channel } from "@foreman/shared";

export function ChannelCards({ channels }: { channels: Channel[] }) {
  const shown = channels.filter((c) => c.role !== 0);
  const display = shown.length > 0 ? shown : channels.slice(0, 1);
  return (
    <div className={styles.wrap}>
      {display.map((ch) => (
        <div key={ch.index} className={channelCardClass(ch.role === 1)}>
          <div className={styles.headerRow}>
            <span className={styles.chLabel}>ch {ch.index}</span>
            <span className={cx(styles.roleLabel, ch.role === 1 && styles.roleLabelPrimary)}>
              {CHANNEL_ROLE[ch.role] ?? ch.role}
            </span>
          </div>
          <div className={styles.name}>
            {ch.name || <span className={styles.namePlaceholder}>(default)</span>}
          </div>
          <div className={styles.pskLine}>{ch.psk ? "PSK ●●●●●●●●" : "no PSK"}</div>
        </div>
      ))}
    </div>
  );
}
