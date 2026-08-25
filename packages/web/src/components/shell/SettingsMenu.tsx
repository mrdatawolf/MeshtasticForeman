import { useRef, useState } from "react";

import { useClickOutside } from "../../hooks/useClickOutside.js";

import { menuBtnClass, menuNavClass, styles } from "./shellStyles.js";

import type { Tab } from "./types.js";

interface Props {
  tab: Tab;
  overrideCount: number;
  onNavigate: (tab: Tab) => void;
}

export function SettingsMenu({ tab, overrideCount, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const navigate = (next: Tab) => {
    onNavigate(next);
    setOpen(false);
  };
  return (
    <div ref={ref} className={styles.menuContainer}>
      <button onClick={() => setOpen((v) => !v)} className={menuBtnClass(open, true)}>
        Settings
        <span className={styles.caret}>▾</span>
      </button>
      {open && (
        <div className={styles.menuPanel}>
          <div className={styles.menuSection}>
            <span className={styles.menuSectionLabel}>Configure</span>
            <button
              className={menuNavClass(tab === "overrides")}
              onClick={() => navigate("overrides")}
            >
              Overrides
              {overrideCount > 0 && <span className={styles.menuCount}>{overrideCount}</span>}
            </button>
            <button className={menuNavClass(tab === "config")} onClick={() => navigate("config")}>
              Device Config
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
