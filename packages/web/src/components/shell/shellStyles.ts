export const KNOWN_TAGS = ["devices", "mqtt", "ws", "db", "foreman"] as const;

export const TAG_COLORS: Record<string, string> = {
  devices: "#60a5fa",
  mqtt: "#34d399",
  ws: "#a78bfa",
  db: "#fb923c",
  foreman: "#94a3b8",
};

export function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "#3b82f6" : "transparent",
    color: active ? "#fff" : "#94a3b8",
    border: "none",
    padding: "0.35rem 1rem",
    borderRadius: "0.375rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.875rem",
  };
}

export function menuBtnStyle(open: boolean, connected: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    background: open ? "#1e293b" : "#0f172a",
    border: `1px solid ${connected ? (open ? "#3b82f6" : "#1e293b") : "#ef4444"}`,
    color: "#e2e8f0",
    padding: "0.25rem 0.65rem",
    borderRadius: "0.375rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.8rem",
    whiteSpace: "nowrap",
  };
}

export function menuNavBtn(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    background: active ? "#1e3a5f" : "#0f172a",
    border: `1px solid ${active ? "#3b82f6" : "#1e293b"}`,
    color: active ? "#e2e8f0" : "#94a3b8",
    padding: "0.2rem 0.6rem",
    borderRadius: "0.25rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.8rem",
  };
}

export function deviceActionBtn(action: "connect" | "disconnect"): React.CSSProperties {
  return {
    background: action === "connect" ? "#14532d" : "#450a0a",
    border: `1px solid ${action === "connect" ? "#16a34a" : "#991b1b"}`,
    color: action === "connect" ? "#4ade80" : "#f87171",
    padding: "0.15rem 0.6rem",
    borderRadius: "0.25rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.72rem",
  };
}

export function hdrFilterBtn(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    background: active ? "#1e3a5f" : "#0f172a",
    border: `1px solid ${active ? "#3b82f6" : "#1e293b"}`,
    color: active ? "#e2e8f0" : "#64748b",
    padding: "0.15rem 0.5rem",
    borderRadius: "0.25rem",
    cursor: "pointer",
    fontSize: "0.72rem",
    fontFamily: "monospace",
  };
}

export const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: "monospace",
    background: "#0f172a",
    color: "#e2e8f0",
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.65rem 1.25rem",
    borderBottom: "1px solid #1e293b",
    flexShrink: 0,
  },
  logo: { height: "2rem", width: "auto", flexShrink: 0 },
  title: { margin: 0, fontSize: "1.25rem", color: "#f8fafc", whiteSpace: "nowrap" },
  nav: { display: "flex", gap: "0.25rem" },
  menuContainer: { position: "relative", flexShrink: 0 },
  menuPanel: {
    position: "absolute",
    top: "calc(100% + 0.4rem)",
    right: 0,
    minWidth: "280px",
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: "0.5rem",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    zIndex: 100,
    overflow: "hidden",
  },
  menuSection: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.6rem 0.75rem",
  },
  menuSectionLabel: {
    width: "100%",
    color: "#334155",
    fontSize: "0.65rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: "0.15rem",
  },
  menuDevice: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "0.8rem",
    padding: "0.1rem 0",
  },
  menuDivider: { height: "1px", background: "#1e293b" },
  menuCount: {
    background: "#334155",
    borderRadius: "9999px",
    padding: "0 0.35rem",
    fontSize: "0.65rem",
  },
  filterLabel: { color: "#475569", fontSize: "0.7rem", whiteSpace: "nowrap" },
  dotBase: {
    width: "0.6rem",
    height: "0.6rem",
    borderRadius: "50%",
    display: "inline-block",
    flexShrink: 0,
  },
  hdrCount: {
    background: "#334155",
    borderRadius: "9999px",
    padding: "0 0.3rem",
    fontSize: "0.6rem",
    marginLeft: "0.1rem",
  },
  badge: {
    padding: "0.15rem 0.5rem",
    borderRadius: "9999px",
    fontSize: "0.75rem",
    color: "#fff",
    fontWeight: "bold",
  },
  tabCount: {
    background: "#334155",
    borderRadius: "9999px",
    padding: "0 0.35rem",
    fontSize: "0.7rem",
    marginLeft: "0.3rem",
  },
};
