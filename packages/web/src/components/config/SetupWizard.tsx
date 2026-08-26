import { useEffect, useMemo, useRef, useState } from "react";

import regionPresetsFallback from "../../../../../region-presets.json";
import { mergeSelectedRegionSettings } from "../../lib/regionMerge.js";
import { buildWizardChanges } from "../../lib/setupWizardOutput.js";
import { foremanClient } from "../../ws/client.js";

import { cx, wizardStyles } from "./configStyles.js";
import { FeaturesStep } from "./FeaturesStep.js";
import { RegionStep } from "./RegionStep.js";
import { ReviewStep } from "./ReviewStep.js";
import { RoleStep } from "./RoleStep.js";
import styles from "./SetupWizard.module.css";

import type { RegionNode, RegionPresets } from "../../lib/regionMerge.js";

export function SetupWizard({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [role, setRole] = useState<number | null>(null);
  const [selectedRegions, setSelectedRegions] = useState<RegionNode[]>([]);
  const [mqttEnabled, setMqttEnabled] = useState(false);
  const [mqttAddress, setMqttAddress] = useState("");
  const [mqttUser, setMqttUser] = useState("");
  const [mqttPass, setMqttPass] = useState("");
  const [neighborInfo, setNeighborInfo] = useState(false);
  const [storeForward, setStoreForward] = useState(false);
  const [presets, setPresets] = useState<RegionPresets | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState(false);
  const listenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const cancelled = false;
    fetch("/api/region-presets")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: RegionPresets) => {
        if (!cancelled && Array.isArray(data?.regions)) setPresets(data);
      })
      .catch(() => {
        if (!cancelled) setPresets(regionPresetsFallback as RegionPresets);
      });
    return () => {
      listenerRef.current?.();
    };
  }, []);

  const selectedLeaf = selectedRegions.at(-1) ?? null;

  // Pre-fill MQTT fields from region defaults when region changes
  useEffect(() => {
    if (selectedLeaf?.mqttDefaults) {
      if (selectedLeaf.mqttDefaults.address) setMqttAddress(selectedLeaf.mqttDefaults.address);
      if (selectedLeaf.mqttDefaults.username) setMqttUser(selectedLeaf.mqttDefaults.username);
      if (selectedLeaf.mqttDefaults.password) setMqttPass(selectedLeaf.mqttDefaults.password);
    }
  }, [selectedLeaf]);

  const mergedRegionSettings = useMemo(
    () => mergeSelectedRegionSettings(selectedRegions),
    [selectedRegions],
  );

  const changes = useMemo(
    () =>
      buildWizardChanges(
        role,
        mergedRegionSettings,
        { enabled: mqttEnabled, address: mqttAddress, user: mqttUser, pass: mqttPass },
        neighborInfo,
        storeForward,
      ),
    [
      role,
      mergedRegionSettings,
      mqttEnabled,
      mqttAddress,
      mqttUser,
      mqttPass,
      neighborInfo,
      storeForward,
    ],
  );

  function applyAll() {
    if (!changes.length || applying) return;
    setApplying(true);
    setApplyError(false);
    for (const ch of changes) {
      foremanClient.send({ type: "device:set-config", payload: { deviceId, ...ch } });
    }
    const timeout = setTimeout(() => {
      listenerRef.current = null;
      setApplying(false);
      setApplied(true);
    }, 12_000);
    listenerRef.current = foremanClient.on((event) => {
      if (event.type === "device:config" && event.payload.deviceId === deviceId) {
        clearTimeout(timeout);
        listenerRef.current = null;
        setApplying(false);
        setApplied(true);
      }
      if (event.type === "error" && event.payload.code === "SET_CONFIG_FAILED") {
        clearTimeout(timeout);
        listenerRef.current?.();
        listenerRef.current = null;
        setApplying(false);
        setApplied(false);
        setApplyError(true);
      }
    });
  }

  const STEP_LABELS = ["Role", "Region", "Features", "Review"];

  return (
    <div className={wizardStyles.overlay} onClick={onClose}>
      <div className={wizardStyles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={wizardStyles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.wizardLabel}>Setup Wizard</span>
            <div className={styles.pipsRow}>
              {STEP_LABELS.map((l, i) => (
                <span
                  key={i}
                  className={cx(
                    wizardStyles.stepPip,
                    i === step ? styles.pipCurrent : i < step ? styles.pipDone : styles.pipUpcoming,
                  )}
                >
                  {i + 1}. {l}
                </span>
              ))}
            </div>
          </div>
          <button className={wizardStyles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Steps */}
        <div className={wizardStyles.body}>
          {step === 0 && <RoleStep role={role} setRole={setRole} onNext={() => setStep(1)} />}
          {step === 1 && (
            <RegionStep
              presets={presets}
              selectedRegions={selectedRegions}
              setSelectedRegions={setSelectedRegions}
              onBack={() => setStep(0)}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <FeaturesStep
              role={role}
              mqttEnabled={mqttEnabled}
              setMqttEnabled={setMqttEnabled}
              mqttAddress={mqttAddress}
              setMqttAddress={setMqttAddress}
              mqttUser={mqttUser}
              setMqttUser={setMqttUser}
              mqttPass={mqttPass}
              setMqttPass={setMqttPass}
              neighborInfo={neighborInfo}
              setNeighborInfo={setNeighborInfo}
              storeForward={storeForward}
              setStoreForward={setStoreForward}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <ReviewStep
              changes={changes}
              applying={applying}
              applied={applied}
              applyError={applyError}
              onBack={() => setStep(2)}
              onApply={applyAll}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
