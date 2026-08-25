import { useRef, useState } from "react";

import { useClickOutside } from "../../hooks/useClickOutside.js";

import { menuBtnStyle, menuNavBtn, styles } from "./shellStyles.js";

import type { MqttScope } from "./types.js";

interface Props {
  enabled: boolean;
  scope: MqttScope;
  gatewayRegion: string | null;
  scopedNodeCount: number;
  totalNodeCount: number;
  onToggle: () => void;
  onScopeChange: (scope: MqttScope) => void;
}

export function MqttMenu({
  enabled,
  scope,
  gatewayRegion,
  scopedNodeCount,
  totalNodeCount,
  onToggle,
  onScopeChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div ref={ref} style={styles.menuContainer}>
      <button onClick={() => setOpen((v) => !v)} style={menuBtnStyle(open, enabled)}>
        <span style={{ color: enabled ? "#4ade80" : "#ef4444", fontSize: "0.65rem" }}>●</span>
        MQTT
        <span style={{ color: "#94a3b8", fontSize: "0.7rem" }}>
          {scope !== "all" ? scope : "all"}
        </span>
        <span style={{ color: "#475569", marginLeft: "0.1rem", fontSize: "0.65rem" }}>▾</span>
      </button>
      {open && (
        <div style={styles.menuPanel}>
          <div style={styles.menuSection}>
            <span style={styles.menuSectionLabel}>MQTT broker</span>
            <button
              onClick={onToggle}
              style={{
                ...menuNavBtn(enabled),
                color: enabled ? "#4ade80" : "#f87171",
                borderColor: enabled ? "#16a34a" : "#ef4444",
                background: enabled ? "#166534" : "#1e293b",
              }}
            >
              {enabled ? "On" : "Off"}
            </button>
          </div>
          <div style={styles.menuDivider} />
          <div style={styles.menuSection}>
            <span style={styles.menuSectionLabel}>
              Region scope
              {gatewayRegion == null && (
                <span style={{ color: "#f59e0b", marginLeft: "0.4rem", fontSize: "0.65rem" }}>
                  (no gateway region)
                </span>
              )}
            </span>
            {gatewayRegion != null && (
              <span
                style={{
                  color: "#475569",
                  fontSize: "0.65rem",
                  fontFamily: "monospace",
                  marginBottom: "0.25rem",
                }}
              >
                {gatewayRegion}
              </span>
            )}
            {(["city", "county", "state", "country", "all"] as MqttScope[]).map((item) => (
              <button
                key={item}
                style={menuNavBtn(scope === item)}
                onClick={() => onScopeChange(item)}
                title={
                  gatewayRegion == null && item !== "all"
                    ? "Gateway region not yet known"
                    : undefined
                }
              >
                {item.charAt(0).toUpperCase() + item.slice(1)}
              </button>
            ))}
            <span style={{ color: "#475569", fontSize: "0.65rem", marginTop: "0.2rem" }}>
              {scope !== "all" && gatewayRegion != null
                ? `${scopedNodeCount} / ${totalNodeCount} nodes`
                : `${totalNodeCount} nodes`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
