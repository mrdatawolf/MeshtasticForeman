import { LAST_SEEN_OPTIONS } from "../../lib/lastSeenFilter.js";

import styles from "./LastSeenFilter.module.css";

import type { LastSeenWindow } from "../../lib/lastSeenFilter.js";

interface Props {
  window: LastSeenWindow;
  shownCount: number;
  totalCount: number;
  onChange: (window: LastSeenWindow) => void;
}

export function LastSeenFilter({ window, shownCount, totalCount, onChange }: Props) {
  return (
    <div className={styles.filter}>
      <label className={styles.label}>
        Last seen
        <select
          className={styles.select}
          value={window}
          onChange={(event) => onChange(event.target.value as LastSeenWindow)}
        >
          {LAST_SEEN_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <span className={styles.count} title="Nodes shown out of all known nodes">
        {shownCount} / {totalCount} nodes
      </span>
    </div>
  );
}
