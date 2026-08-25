import { useRef, useState } from "react";

import { useClickOutside } from "../../hooks/useClickOutside.js";

import mqttStyles from "./MqttMenu.module.css";
import { menuBtnClass, menuNavClass, styles } from "./shellStyles.js";

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
    <div ref={ref} className={styles.menuContainer}>
      <button onClick={() => setOpen((v) => !v)} className={menuBtnClass(open, enabled)}>
        <span className={enabled ? mqttStyles.mqttDotOn : mqttStyles.mqttDotOff}>●</span>
        MQTT
        <span className={mqttStyles.mqttScopeLabel}>{scope !== "all" ? scope : "all"}</span>
        <span className={`${styles.caret} ${styles.caretTight}`}>▾</span>
      </button>
      {open && (
        <div className={styles.menuPanel}>
          <div className={styles.menuSection}>
            <span className={styles.menuSectionLabel}>MQTT broker</span>
            <button
              onClick={onToggle}
              className={`${mqttStyles.mqttToggleBtn} ${enabled ? mqttStyles.mqttToggleOn : mqttStyles.mqttToggleOff}`}
            >
              {enabled ? "On" : "Off"}
            </button>
          </div>
          <div className={styles.menuDivider} />
          <div className={styles.menuSection}>
            <span className={styles.menuSectionLabel}>
              Region scope
              {gatewayRegion == null && (
                <span className={mqttStyles.mqttNoRegionWarning}>(no gateway region)</span>
              )}
            </span>
            {gatewayRegion != null && (
              <span className={mqttStyles.mqttGatewayRegion}>{gatewayRegion}</span>
            )}
            {(["city", "county", "state", "country", "all"] as MqttScope[]).map((item) => (
              <button
                key={item}
                className={menuNavClass(scope === item)}
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
            <span className={mqttStyles.mqttNodeCount}>
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
