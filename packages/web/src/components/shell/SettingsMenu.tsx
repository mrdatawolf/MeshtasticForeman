import { useRef, useState } from "react";

import { useClickOutside } from "../../hooks/useClickOutside.js";

import { menuBtnStyle, menuNavBtn, styles } from "./shellStyles.js";

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
    <div ref={ref} style={styles.menuContainer}>
      <button onClick={() => setOpen((v) => !v)} style={menuBtnStyle(open, true)}>
        Settings
        <span style={{ color: "#475569", marginLeft: "0.3rem", fontSize: "0.65rem" }}>▾</span>
      </button>
      {open && (
        <div style={styles.menuPanel}>
          <div style={styles.menuSection}>
            <span style={styles.menuSectionLabel}>Configure</span>
            <button style={menuNavBtn(tab === "overrides")} onClick={() => navigate("overrides")}>
              Overrides{overrideCount > 0 && <span style={styles.menuCount}>{overrideCount}</span>}
            </button>
            <button style={menuNavBtn(tab === "config")} onClick={() => navigate("config")}>
              Device Config
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
