import { styles, tabClass } from "./shellStyles.js";

import type { Tab } from "./types.js";

interface Props {
  tab: Tab;
  onNavigate: (tab: Tab) => void;
}

export function MainNavigation({ tab, onNavigate }: Props) {
  return (
    <nav className={styles.nav}>
      <button className={tabClass(tab === "nodes")} onClick={() => onNavigate("nodes")}>
        Nodes
      </button>
      <button className={tabClass(tab === "map")} onClick={() => onNavigate("map")}>
        Map
      </button>
      <button className={tabClass(tab === "messages")} onClick={() => onNavigate("messages")}>
        Messages
      </button>
      <button className={tabClass(tab === "analytics")} onClick={() => onNavigate("analytics")}>
        Analytics
      </button>
    </nav>
  );
}
