import { styles, tabStyle } from "./shellStyles.js";

import type { Tab } from "./types.js";

interface Props {
  tab: Tab;
  onNavigate: (tab: Tab) => void;
}

export function MainNavigation({ tab, onNavigate }: Props) {
  return (
    <nav style={styles.nav}>
      <button style={tabStyle(tab === "nodes")} onClick={() => onNavigate("nodes")}>
        Nodes
      </button>
      <button style={tabStyle(tab === "map")} onClick={() => onNavigate("map")}>
        Map
      </button>
      <button style={tabStyle(tab === "messages")} onClick={() => onNavigate("messages")}>
        Messages
      </button>
      <button style={tabStyle(tab === "analytics")} onClick={() => onNavigate("analytics")}>
        Analytics
      </button>
    </nav>
  );
}
