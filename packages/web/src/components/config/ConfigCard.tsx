import { useEffect, useRef, useState } from "react";

import {
  applyDraftEdit,
  buildConfigCardSetConfigPayload,
  currentFieldValue,
} from "../../lib/configCardTransform.js";
import { foremanClient } from "../../ws/client.js";

import localStyles from "./ConfigCard.module.css";
import { camelToLabel, ENUM_LOOKUPS, SENSITIVE_KEYS, visibleEntries } from "./configConstants.js";
import {
  configCardClass,
  cx,
  namespacePillClass,
  rowClass,
  saveBtnClass,
  styles,
} from "./configStyles.js";
import { canEdit, FieldDisplay, FieldEditor } from "./FieldEditors.js";

export function ConfigCard({
  section,
  namespace,
  data,
  deviceId,
}: {
  section: string;
  namespace: "radio" | "module";
  data: Record<string, unknown>;
  deviceId: string;
}) {
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "error">("idle");
  const listenerRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      listenerRef.current?.();
    },
    [],
  );

  const entries = visibleEntries(data);
  const isActive = !("enabled" in data) || (data as Record<string, unknown>).enabled !== false;
  const enumMap = ENUM_LOOKUPS[section] ?? {};

  function currentVal(key: string): unknown {
    return currentFieldValue(draft, data, key);
  }
  function handleChange(key: string, val: unknown) {
    setDraft((p) => applyDraftEdit(p, key, val));
  }

  function handleSave() {
    const payload = buildConfigCardSetConfigPayload(deviceId, namespace, section, draft);
    if (!payload) {
      setEditMode(false);
      return;
    }
    setSaving(true);
    foremanClient.send({ type: "device:set-config", payload });
    const timeout = setTimeout(() => {
      listenerRef.current = null;
      setSaving(false);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 4000);
    }, 10_000);
    listenerRef.current = foremanClient.on((event) => {
      const configNamespace = namespace === "radio" ? "radioConfig" : "moduleConfig";
      if (
        event.type === "device:config" &&
        event.payload.deviceId === deviceId &&
        Object.hasOwn(event.payload[configNamespace], section)
      ) {
        clearTimeout(timeout);
        listenerRef.current = null;
        setSaving(false);
        setEditMode(false);
        setDraft({});
        setSaveStatus("ok");
        setTimeout(() => setSaveStatus("idle"), 2500);
      }
      if (event.type === "error" && event.payload.code === "SET_CONFIG_FAILED") {
        clearTimeout(timeout);
        listenerRef.current = null;
        setSaving(false);
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 4000);
      }
    });
  }

  return (
    <div className={configCardClass(isActive)}>
      <div className={styles.cardHeader}>
        <div className={localStyles.headerLeft}>
          <span className={localStyles.sectionLabel}>{camelToLabel(section)}</span>
          <span className={namespacePillClass(namespace)}>{namespace}</span>
          {!isActive && <span className={styles.disabledPill}>off</span>}
        </div>
        <div className={localStyles.headerRight}>
          {!editMode ? (
            <button className={styles.editBtn} onClick={() => setEditMode(true)}>
              Edit
            </button>
          ) : (
            <>
              <button
                className={styles.cancelBtn}
                onClick={() => {
                  setDraft({});
                  setEditMode(false);
                }}
              >
                Cancel
              </button>
              <button className={saveBtnClass(saving)} disabled={saving} onClick={handleSave}>
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>
      <div className={styles.cardBody}>
        {entries.map(([k]) => {
          const inDraft = k in draft;
          const sensitive = SENSITIVE_KEYS.has(k);
          const val = currentVal(k);
          const lookup = enumMap[k];
          return (
            <div key={k} className={rowClass(inDraft)}>
              <span className={styles.rowKey}>{camelToLabel(k)}</span>
              <span className={styles.rowVal}>
                {editMode && canEdit(k, val) && !sensitive ? (
                  <FieldEditor fieldKey={k} value={val} onChange={handleChange} />
                ) : (
                  <FieldDisplay value={val} sensitive={sensitive} lookup={lookup} />
                )}
              </span>
            </div>
          );
        })}
      </div>
      {saveStatus === "ok" && (
        <div className={cx(localStyles.statusBanner, localStyles.statusBannerOk)}>Saved ✓</div>
      )}
      {saveStatus === "error" && (
        <div className={cx(localStyles.statusBanner, localStyles.statusBannerError)}>
          Save failed — check device connection
        </div>
      )}
    </div>
  );
}
