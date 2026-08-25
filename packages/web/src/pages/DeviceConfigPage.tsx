import { MODEM_PRESET_LABELS } from "@foreman/shared";
import { useState, useEffect, useRef, useMemo } from "react";

import regionPresetsFallback from "../../../../region-presets.json";
import { mergeConfig } from "../lib/configMerge.js";
import { buildWizardChanges, type ConfigChange } from "../lib/setupWizardOutput.js";
import { foremanClient } from "../ws/client.js";

import type { DeviceConfig, DeviceInfo, Channel } from "@foreman/shared";

interface Props {
  devices: DeviceInfo[];
  configs: Map<string, DeviceConfig>;
  autoOpenWizard?: boolean;
  onWizardOpened?: () => void;
}

// ---------------------------------------------------------------------------
// Region preset types (mirrors region-presets.json)
// ---------------------------------------------------------------------------
interface RegionNode {
  id: string;
  label: string;
  description?: string;
  settings?: Record<string, Record<string, Record<string, unknown>>>;
  mqttDefaults?: { address?: string; username?: string; password?: string };
  children?: RegionNode[];
}
interface RegionPresets {
  version: number;
  regions: RegionNode[];
}

// ---------------------------------------------------------------------------
// Enum display tables
// ---------------------------------------------------------------------------
const DEVICE_ROLE: Record<number, string> = {
  0: "CLIENT",
  1: "CLIENT_MUTE",
  2: "ROUTER",
  3: "ROUTER_CLIENT",
  4: "REPEATER",
  5: "TRACKER",
  6: "SENSOR",
  7: "TAK",
  8: "CLIENT_HIDDEN",
  9: "LOST_AND_FOUND",
  10: "TAK_TRACKER",
};
const LORA_REGION: Record<number, string> = {
  0: "UNSET",
  1: "US",
  2: "EU_433",
  3: "EU_868",
  4: "CN",
  5: "JP",
  6: "ANZ",
  7: "KR",
  8: "TW",
  9: "RU",
  10: "IN",
  11: "NZ_865",
  12: "TH",
  13: "LORA_24",
  14: "UA_433",
  15: "UA_868",
  16: "MY_433",
  17: "MY_919",
  18: "SG_923",
};
const CHANNEL_ROLE: Record<number, string> = { 0: "DISABLED", 1: "PRIMARY", 2: "SECONDARY" };
const ENUM_LOOKUPS: Record<string, Record<string, Record<number, string>>> = {
  device: { role: DEVICE_ROLE },
  lora: { region: LORA_REGION, modemPreset: MODEM_PRESET_LABELS },
};

const SENSITIVE_KEYS = new Set([
  "privateKey",
  "publicKey",
  "adminKey",
  "password",
  "psk",
  "fixedPin",
]);

// ---------------------------------------------------------------------------
// Wizard role definitions
// ---------------------------------------------------------------------------
const ROLES = [
  { value: 0, label: "Client", sub: "Normal user device. Sends and receives messages." },
  { value: 2, label: "Router", sub: "Dedicated relay. Rebroadcasts packets, no messages." },
  { value: 4, label: "Repeater", sub: "Pure relay. No NodeInfo or position broadcasts." },
  { value: 5, label: "Tracker", sub: "Location tracker. Broadcasts position frequently." },
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function camelToLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}

function visibleEntries(data: Record<string, unknown>): [string, unknown][] {
  return Object.entries(data).filter(([k]) => k !== "$typeName");
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function DeviceConfigPage({ devices, configs, autoOpenWizard, onWizardOpened }: Props) {
  const connectedDevices = devices.filter((d) => d.status === "connected");
  const [selectedId, setSelectedId] = useState<string | null>(connectedDevices[0]?.id ?? null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const config = selectedId ? configs.get(selectedId) : null;
  const device = devices.find((d) => d.id === selectedId);
  const deviceConnected = device?.status === "connected";

  useEffect(() => {
    if (!selectedId) return;
    foremanClient.send({ type: "device:config-request", payload: { deviceId: selectedId } });
  }, [selectedId]);

  useEffect(() => {
    if (autoOpenWizard && selectedId && config) {
      setWizardOpen(true);
      onWizardOpened?.();
    }
  }, [autoOpenWizard, selectedId, config]);

  useEffect(() => {
    if (!wizardOpen || deviceConnected) return;
    setWizardOpen(false);
  }, [wizardOpen, deviceConnected]);

  const radioEntries = config
    ? Object.entries(config.radioConfig).filter(
        ([k, v]) => k !== "sessionkey" && visibleEntries(v as Record<string, unknown>).length > 0,
      )
    : [];
  const moduleEntries = config
    ? Object.entries(config.moduleConfig).filter(
        ([, v]) => visibleEntries(v as Record<string, unknown>).length > 0,
      )
    : [];

  return (
    <div style={styles.page}>
      {devices.length > 1 && (
        <div style={styles.deviceBar}>
          {devices.map((d) => (
            <button
              key={d.id}
              style={deviceBtnStyle(d.id === selectedId, d.status === "connected")}
              onClick={() => setSelectedId(d.id)}
            >
              <span style={{ color: d.status === "connected" ? "#22c55e" : "#ef4444" }}>●</span>
              {d.port}
            </button>
          ))}
        </div>
      )}

      {!config ? (
        <div style={styles.empty}>
          {device ? `No config received yet for ${device.port}.` : "No device selected."}
        </div>
      ) : (
        <div style={styles.body}>
          {/* Wizard launcher */}
          <div style={styles.wizardBar}>
            <div>
              <div style={styles.wizardBarTitle}>Setup Wizard</div>
              <div style={styles.wizardBarSub}>
                {deviceConnected
                  ? "Guided role, region, and feature configuration"
                  : "Connect a device to use the setup wizard"}
              </div>
            </div>
            <button
              style={wizardLaunchBtnStyle(deviceConnected)}
              onClick={() => setWizardOpen(true)}
              disabled={!deviceConnected}
              title={deviceConnected ? "Launch setup wizard" : "A connected device is required"}
            >
              Launch Wizard →
            </button>
          </div>

          {/* Channels */}
          <Section title="Channels">
            <ChannelCards channels={config.channels} />
          </Section>

          {radioEntries.length > 0 && (
            <Section title="Radio Config">
              <div style={styles.cardGrid}>
                {radioEntries.map(([key, value]) => (
                  <ConfigCard
                    key={key}
                    section={key}
                    namespace="radio"
                    data={value as Record<string, unknown>}
                    deviceId={selectedId!}
                  />
                ))}
              </div>
            </Section>
          )}

          {moduleEntries.length > 0 && (
            <Section title="Module Config">
              <div style={styles.cardGrid}>
                {moduleEntries.map(([key, value]) => (
                  <ConfigCard
                    key={key}
                    section={key}
                    namespace="module"
                    data={value as Record<string, unknown>}
                    deviceId={selectedId!}
                  />
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {wizardOpen && selectedId && (
        <SetupWizard deviceId={selectedId} onClose={() => setWizardOpen(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup Wizard
// ---------------------------------------------------------------------------
function SetupWizard({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
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

  const mergedRegionSettings = useMemo(() => {
    return selectedRegions.reduce(
      (acc, node) => {
        return node.settings ? mergeConfig(acc, node.settings as Record<string, unknown>) : acc;
      },
      {} as Record<string, unknown>,
    );
  }, [selectedRegions]);

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
    for (const ch of changes) {
      foremanClient.send({ type: "device:set-config", payload: { deviceId, ...ch } });
    }
    const timeout = setTimeout(() => {
      listenerRef.current = null;
      setApplying(false);
      setApplied(true);
    }, 12_000);
    listenerRef.current = foremanClient.on((event) => {
      if (event.type === "device:config") {
        clearTimeout(timeout);
        listenerRef.current = null;
        setApplying(false);
        setApplied(true);
      }
    });
  }

  const STEP_LABELS = ["Role", "Region", "Features", "Review"];

  return (
    <div style={wizardStyles.overlay} onClick={onClose}>
      <div style={wizardStyles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={wizardStyles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
            <span
              style={{
                color: "#94a3b8",
                fontSize: "0.72rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Setup Wizard
            </span>
            <div style={{ display: "flex", gap: "0.25rem" }}>
              {STEP_LABELS.map((l, i) => (
                <span
                  key={i}
                  style={{
                    ...wizardStyles.stepPip,
                    background: i === step ? "#3b82f6" : i < step ? "#1e3a5f" : "#1e293b",
                    color: i <= step ? "#e2e8f0" : "#475569",
                  }}
                >
                  {i + 1}. {l}
                </span>
              ))}
            </div>
          </div>
          <button style={wizardStyles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Steps */}
        <div style={wizardStyles.body}>
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

// ---------------------------------------------------------------------------
// Step 1 — Role
// ---------------------------------------------------------------------------
function RoleStep({
  role,
  setRole,
  onNext,
}: {
  role: number | null;
  setRole: (r: number) => void;
  onNext: () => void;
}) {
  return (
    <div style={wizardStyles.step}>
      <div style={wizardStyles.stepTitle}>What is this device?</div>
      <div style={wizardStyles.stepSub}>
        Sets the device role. This affects how it behaves on the mesh.
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.6rem",
          marginTop: "1rem",
        }}
      >
        {ROLES.map((r) => (
          <button
            key={r.value}
            style={wizardRoleBtn(role === r.value)}
            onClick={() => setRole(r.value)}
          >
            <span style={{ color: "#e2e8f0", fontWeight: "bold", fontSize: "0.9rem" }}>
              {r.label}
            </span>
            <span
              style={{
                color: "#64748b",
                fontSize: "0.75rem",
                marginTop: "0.2rem",
                lineHeight: 1.4,
              }}
            >
              {r.sub}
            </span>
          </button>
        ))}
      </div>
      <div style={wizardStyles.nav}>
        <span />
        <button style={navBtn(role === null)} disabled={role === null} onClick={onNext}>
          Next →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Region
// ---------------------------------------------------------------------------
function RegionStep({
  presets,
  selectedRegions,
  setSelectedRegions,
  onBack,
  onNext,
}: {
  presets: RegionPresets | null;
  selectedRegions: RegionNode[];
  setSelectedRegions: (regions: RegionNode[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const topLevel = presets?.regions ?? [];
  const selectedLeaf = selectedRegions.at(-1) ?? null;
  const columns: { title: string; options: RegionNode[]; level: number; optional: boolean }[] = [];

  if (topLevel.length > 0) {
    columns.push({
      title: "Region",
      options: topLevel,
      level: 0,
      optional: false,
    });
  }

  selectedRegions.forEach((region, index) => {
    if ((region.children?.length ?? 0) > 0) {
      columns.push({
        title: `Specific area within ${region.label}`,
        options: region.children ?? [],
        level: index + 1,
        optional: true,
      });
    }
  });

  function selectRegion(level: number, region: RegionNode) {
    setSelectedRegions([...selectedRegions.slice(0, level), region]);
  }

  return (
    <div style={wizardStyles.step}>
      <div style={wizardStyles.stepTitle}>Where is this device?</div>
      <div style={wizardStyles.stepSub}>
        Sets the LoRa region, modem preset, and MQTT defaults for your area.
      </div>

      {presets === null ? (
        <div style={wizardStyles.stepEmpty}>Loading region presets…</div>
      ) : columns.length === 0 ? (
        <div style={wizardStyles.stepEmpty}>No region presets are available.</div>
      ) : (
        <>
          {selectedRegions.length > 0 && (
            <div style={wizardStyles.breadcrumbs}>
              {selectedRegions.map((region, index) => (
                <button
                  key={region.id}
                  style={wizardBreadcrumbBtn(index === selectedRegions.length - 1)}
                  onClick={() => setSelectedRegions(selectedRegions.slice(0, index + 1))}
                >
                  {region.label}
                </button>
              ))}
            </div>
          )}

          {columns.map((column) => (
            <div key={`${column.title}-${column.level}`} style={{ marginTop: "1rem" }}>
              <div
                style={{
                  color: "#64748b",
                  fontSize: "0.65rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  marginBottom: "0.4rem",
                }}
              >
                {column.title}
                {column.optional ? " (optional)" : ""}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: "0.5rem",
                }}
              >
                {column.options.map((region) => {
                  const active = selectedRegions[column.level]?.id === region.id;
                  return (
                    <button
                      key={region.id}
                      style={wizardRegionBtn(active, column.level > 0)}
                      onClick={() => selectRegion(column.level, region)}
                    >
                      <span style={{ color: "#e2e8f0", fontSize: "0.85rem", fontWeight: "bold" }}>
                        {region.label}
                      </span>
                      {region.description && (
                        <span style={{ color: "#64748b", fontSize: "0.72rem" }}>
                          {region.description}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {selectedLeaf?.children?.length === 0 && (
            <div style={wizardStyles.selectionHint}>
              {selectedLeaf
                ? `Selected: ${selectedRegions.map((region) => region.label).join(" / ")}`
                : ""}
            </div>
          )}
        </>
      )}

      <div style={wizardStyles.nav}>
        <button style={navBtn(false)} onClick={onBack}>
          ← Back
        </button>
        <button
          style={navBtn(selectedRegions.length === 0)}
          disabled={selectedRegions.length === 0}
          onClick={onNext}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Features
// ---------------------------------------------------------------------------
function FeaturesStep({
  role,
  mqttEnabled,
  setMqttEnabled,
  mqttAddress,
  setMqttAddress,
  mqttUser,
  setMqttUser,
  mqttPass,
  setMqttPass,
  neighborInfo,
  setNeighborInfo,
  storeForward,
  setStoreForward,
  onBack,
  onNext,
}: {
  role: number | null;
  mqttEnabled: boolean;
  setMqttEnabled: (v: boolean) => void;
  mqttAddress: string;
  setMqttAddress: (v: string) => void;
  mqttUser: string;
  setMqttUser: (v: string) => void;
  mqttPass: string;
  setMqttPass: (v: string) => void;
  neighborInfo: boolean;
  setNeighborInfo: (v: boolean) => void;
  storeForward: boolean;
  setStoreForward: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div style={wizardStyles.step}>
      <div style={wizardStyles.stepTitle}>Optional features</div>
      <div style={wizardStyles.stepSub}>
        Enable any combination. You can change these later via the config cards.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
        {/* MQTT */}
        <div style={featureBlock(mqttEnabled)}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <button style={toggleBtn(mqttEnabled)} onClick={() => setMqttEnabled(!mqttEnabled)}>
              {mqttEnabled ? "ON" : "OFF"}
            </button>
            <div>
              <div style={{ color: "#e2e8f0", fontSize: "0.85rem", fontWeight: "bold" }}>
                MQTT uplink
              </div>
              <div style={{ color: "#64748b", fontSize: "0.74rem" }}>
                Forward mesh traffic to an MQTT broker
              </div>
            </div>
          </div>
          {mqttEnabled && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.4rem",
                marginTop: "0.65rem",
                paddingTop: "0.65rem",
                borderTop: "1px solid #1e293b",
              }}
            >
              <FieldInput
                label="Broker address"
                value={mqttAddress}
                onChange={setMqttAddress}
                placeholder="localhost"
              />
              <FieldInput label="Username" value={mqttUser} onChange={setMqttUser} placeholder="" />
              <FieldInput
                label="Password"
                value={mqttPass}
                onChange={setMqttPass}
                placeholder=""
                type="password"
              />
            </div>
          )}
        </div>

        {/* Neighbor Info */}
        <div style={featureBlock(neighborInfo)}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <button style={toggleBtn(neighborInfo)} onClick={() => setNeighborInfo(!neighborInfo)}>
              {neighborInfo ? "ON" : "OFF"}
            </button>
            <div>
              <div style={{ color: "#e2e8f0", fontSize: "0.85rem", fontWeight: "bold" }}>
                Neighbor Info
              </div>
              <div style={{ color: "#64748b", fontSize: "0.74rem" }}>
                Broadcasts heard-neighbor list every 15 min — required for the Network graph
              </div>
            </div>
          </div>
        </div>

        {/* Store & Forward — only meaningful for router/client */}
        {(role === 0 || role === 2 || role === 3) && (
          <div style={featureBlock(storeForward)}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <button
                style={toggleBtn(storeForward)}
                onClick={() => setStoreForward(!storeForward)}
              >
                {storeForward ? "ON" : "OFF"}
              </button>
              <div>
                <div style={{ color: "#e2e8f0", fontSize: "0.85rem", fontWeight: "bold" }}>
                  Store & Forward server
                </div>
                <div style={{ color: "#64748b", fontSize: "0.74rem" }}>
                  Cache and replay missed messages — best on well-connected nodes
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={wizardStyles.nav}>
        <button style={navBtn(false)} onClick={onBack}>
          ← Back
        </button>
        <button style={navBtn(false)} onClick={onNext}>
          Review →
        </button>
      </div>
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <span style={{ color: "#64748b", fontSize: "0.75rem", width: "9rem", flexShrink: 0 }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={styles.inputText}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Review
// ---------------------------------------------------------------------------
function ReviewStep({
  changes,
  applying,
  applied,
  onBack,
  onApply,
  onClose,
}: {
  changes: ConfigChange[];
  applying: boolean;
  applied: boolean;
  onBack: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const grouped = useMemo(() => {
    const out: Record<string, { namespace: string; entries: [string, unknown][] }> = {};
    for (const ch of changes) {
      const key = `${ch.namespace}.${ch.section}`;
      out[key] = { namespace: ch.namespace, entries: Object.entries(ch.value) };
    }
    return out;
  }, [changes]);

  if (applied) {
    return (
      <div
        style={{
          ...wizardStyles.step,
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
        }}
      >
        <div style={{ color: "#22c55e", fontSize: "2rem" }}>✓</div>
        <div style={{ color: "#e2e8f0", fontSize: "1rem", fontWeight: "bold" }}>Config applied</div>
        <div style={{ color: "#64748b", fontSize: "0.8rem" }}>
          The device will take a moment to confirm each change.
        </div>
        <button style={navBtn(false)} onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  if (changes.length === 0) {
    return (
      <div
        style={{
          ...wizardStyles.step,
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
        }}
      >
        <div style={{ color: "#64748b", fontSize: "0.85rem" }}>
          No changes selected. Go back and choose a role, region, or feature.
        </div>
        <div style={wizardStyles.nav}>
          <button style={navBtn(false)} onClick={onBack}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={wizardStyles.step}>
      <div style={wizardStyles.stepTitle}>Review changes</div>
      <div style={wizardStyles.stepSub}>
        These settings will be written to the device. Review before applying.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginTop: "1rem" }}>
        {Object.entries(grouped).map(([key, { namespace, entries }]) => (
          <div
            key={key}
            style={{
              background: "#0d1420",
              border: "1px solid #1e293b",
              borderRadius: "0.375rem",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                background: "#0f172a",
                padding: "0.3rem 0.75rem",
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                borderBottom: "1px solid #1e293b",
              }}
            >
              <span style={{ color: "#e2e8f0", fontSize: "0.78rem", fontWeight: "bold" }}>
                {key.split(".")[1]}
              </span>
              <span style={namespacePill(namespace as "radio" | "module")}>{namespace}</span>
            </div>
            <div
              style={{
                padding: "0.4rem 0.75rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.15rem",
              }}
            >
              {entries.map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: "0.75rem", fontSize: "0.78rem" }}>
                  <span style={{ color: "#7a8fa6", width: "13rem", flexShrink: 0 }}>
                    {camelToLabel(k)}
                  </span>
                  <span style={{ color: "#4ade80" }}>{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={wizardStyles.nav}>
        <button style={navBtn(false)} onClick={onBack}>
          ← Back
        </button>
        <button style={applyBtn(applying)} disabled={applying} onClick={onApply}>
          {applying ? "Applying…" : "Apply to device"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config card (unchanged from previous version)
// ---------------------------------------------------------------------------
function ConfigCard({
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
    return key in draft ? draft[key] : data[key];
  }
  function handleChange(key: string, val: unknown) {
    setDraft((p) => ({ ...p, [key]: val }));
  }

  function handleSave() {
    if (Object.keys(draft).length === 0) {
      setEditMode(false);
      return;
    }
    setSaving(true);
    foremanClient.send({
      type: "device:set-config",
      payload: { deviceId, namespace, section, value: draft },
    });
    const timeout = setTimeout(() => {
      listenerRef.current = null;
      setSaving(false);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 4000);
    }, 10_000);
    listenerRef.current = foremanClient.on((event) => {
      if (event.type === "device:config") {
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
    <div style={configCardStyle(isActive)}>
      <div style={styles.cardHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ color: "#e2e8f0", fontSize: "0.82rem", fontWeight: "bold" }}>
            {camelToLabel(section)}
          </span>
          <span style={namespacePill(namespace)}>{namespace}</span>
          {!isActive && <span style={styles.disabledPill}>off</span>}
        </div>
        <div style={{ display: "flex", gap: "0.3rem" }}>
          {!editMode ? (
            <button style={styles.editBtn} onClick={() => setEditMode(true)}>
              Edit
            </button>
          ) : (
            <>
              <button
                style={styles.cancelBtn}
                onClick={() => {
                  setDraft({});
                  setEditMode(false);
                }}
              >
                Cancel
              </button>
              <button style={saveBtnStyle(saving)} disabled={saving} onClick={handleSave}>
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>
      <div style={styles.cardBody}>
        {entries.map(([k]) => {
          const inDraft = k in draft;
          const sensitive = SENSITIVE_KEYS.has(k);
          const val = currentVal(k);
          const lookup = enumMap[k];
          return (
            <div key={k} style={rowStyle(inDraft)}>
              <span style={styles.rowKey}>{camelToLabel(k)}</span>
              <span style={styles.rowVal}>
                {editMode && canEdit(k, val) && !sensitive
                  ? renderEditor(k, val, handleChange)
                  : renderDisplay(val, sensitive, lookup)}
              </span>
            </div>
          );
        })}
      </div>
      {saveStatus === "ok" && (
        <div
          style={{
            padding: "0.3rem 0.75rem",
            background: "#052e16",
            color: "#4ade80",
            fontSize: "0.72rem",
            borderTop: "1px solid #1e293b",
          }}
        >
          Saved ✓
        </div>
      )}
      {saveStatus === "error" && (
        <div
          style={{
            padding: "0.3rem 0.75rem",
            background: "#2d0f0f",
            color: "#f87171",
            fontSize: "0.72rem",
            borderTop: "1px solid #1e293b",
          }}
        >
          Save failed — check device connection
        </div>
      )}
    </div>
  );
}

function canEdit(key: string, val: unknown): boolean {
  if (SENSITIVE_KEYS.has(key)) return false;
  if (Array.isArray(val) || (val !== null && typeof val === "object")) return false;
  return true;
}

function renderEditor(key: string, val: unknown, onChange: (k: string, v: unknown) => void) {
  if (typeof val === "boolean") {
    return (
      <button style={toggleBtn(val)} onClick={() => onChange(key, !val)}>
        {val ? "ON" : "OFF"}
      </button>
    );
  }
  if (typeof val === "number") {
    return (
      <input
        type="number"
        value={val}
        onChange={(e) => onChange(key, Number(e.target.value))}
        style={styles.inputNum}
      />
    );
  }
  return (
    <input
      type="text"
      value={String(val ?? "")}
      onChange={(e) => onChange(key, e.target.value)}
      style={styles.inputText}
    />
  );
}

function renderDisplay(val: unknown, sensitive: boolean, lookup?: Record<number, string>) {
  if (sensitive) return <span style={{ color: "#334155", letterSpacing: "0.1em" }}>••••••••</span>;
  if (val === null || val === undefined) return <span style={{ color: "#334155" }}>—</span>;
  if (typeof val === "boolean")
    return <span style={{ color: val ? "#22c55e" : "#64748b" }}>{val ? "true" : "false"}</span>;
  if (typeof val === "number") {
    if (lookup?.[val]) {
      return (
        <span>
          <span style={{ color: "#e2e8f0" }}>{lookup[val]}</span>
          <span style={{ color: "#334155", marginLeft: "0.4rem", fontSize: "0.7rem" }}>
            ({val})
          </span>
        </span>
      );
    }
    return <span style={{ color: "#e2e8f0" }}>{val}</span>;
  }
  if (typeof val === "string")
    return val === "" ? (
      <span style={{ color: "#334155" }}>{`""`}</span>
    ) : (
      <span style={{ color: "#e2e8f0" }}>{val}</span>
    );
  if (Array.isArray(val))
    return (
      <span style={{ color: "#64748b" }}>{val.length === 0 ? "[]" : JSON.stringify(val)}</span>
    );
  return <span style={{ color: "#64748b", fontSize: "0.72rem" }}>{JSON.stringify(val)}</span>;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------
function ChannelCards({ channels }: { channels: Channel[] }) {
  const shown = channels.filter((c) => c.role !== 0);
  const display = shown.length > 0 ? shown : channels.slice(0, 1);
  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      {display.map((ch) => (
        <div key={ch.index} style={channelCardStyle(ch.role === 1)}>
          <div
            style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}
          >
            <span style={{ color: "#64748b", fontSize: "0.65rem", textTransform: "uppercase" }}>
              ch {ch.index}
            </span>
            <span style={{ color: ch.role === 1 ? "#22c55e" : "#64748b", fontSize: "0.7rem" }}>
              {CHANNEL_ROLE[ch.role] ?? ch.role}
            </span>
          </div>
          <div
            style={{
              color: "#e2e8f0",
              fontSize: "0.85rem",
              fontWeight: "bold",
              marginBottom: "0.2rem",
            }}
          >
            {ch.name || <span style={{ color: "#475569" }}>(default)</span>}
          </div>
          <div style={{ color: "#475569", fontSize: "0.72rem", fontFamily: "monospace" }}>
            {ch.psk ? "PSK ●●●●●●●●" : "no PSK"}
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------
function namespacePill(ns: "radio" | "module"): React.CSSProperties {
  return {
    fontSize: "0.6rem",
    padding: "0.1rem 0.4rem",
    borderRadius: "9999px",
    border: `1px solid ${ns === "radio" ? "#1e3a5f" : "#1e293b"}`,
    color: ns === "radio" ? "#60a5fa" : "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };
}

function configCardStyle(active: boolean): React.CSSProperties {
  return {
    background: "#0d1420",
    border: "1px solid #1e293b",
    borderRadius: "0.375rem",
    overflow: "hidden",
    opacity: active ? 1 : 0.55,
    display: "flex",
    flexDirection: "column",
  };
}

function channelCardStyle(primary: boolean): React.CSSProperties {
  return {
    background: "#0d1420",
    border: `1px solid ${primary ? "#22c55e" : "#1e293b"}`,
    borderRadius: "0.375rem",
    padding: "0.6rem 0.85rem",
    minWidth: "140px",
  };
}

function rowStyle(inDraft: boolean): React.CSSProperties {
  return {
    display: "flex",
    gap: "0.75rem",
    fontSize: "0.78rem",
    lineHeight: "1.5",
    padding: "0.15rem 0.2rem",
    borderRadius: "0.2rem",
    background: inDraft ? "#0f2a1a" : undefined,
  };
}

function deviceBtnStyle(active: boolean, connected: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    background: active ? "#1e293b" : "transparent",
    border: `1px solid ${active ? "#3b82f6" : "#1e293b"}`,
    color: connected ? "#e2e8f0" : "#64748b",
    padding: "0.2rem 0.7rem",
    borderRadius: "0.375rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.8rem",
  };
}

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? "#1e293b" : "#1e3a5f",
    border: "none",
    color: disabled ? "#475569" : "#93c5fd",
    padding: "0.35rem 1rem",
    borderRadius: "0.375rem",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "monospace",
    fontSize: "0.82rem",
  };
}

function applyBtn(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? "#1e293b" : "#1d4ed8",
    border: "none",
    color: disabled ? "#475569" : "#fff",
    padding: "0.35rem 1.25rem",
    borderRadius: "0.375rem",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "monospace",
    fontSize: "0.85rem",
    fontWeight: "bold",
  };
}

function saveBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? "#1e293b" : "#1d4ed8",
    border: "none",
    color: disabled ? "#64748b" : "#fff",
    padding: "0.15rem 0.65rem",
    borderRadius: "0.25rem",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "monospace",
    fontSize: "0.75rem",
  };
}

function wizardLaunchBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    background: enabled ? "#1e3a5f" : "#1e293b",
    border: `1px solid ${enabled ? "#3b82f6" : "#334155"}`,
    color: enabled ? "#93c5fd" : "#64748b",
    padding: "0.35rem 1rem",
    borderRadius: "0.375rem",
    cursor: enabled ? "pointer" : "not-allowed",
    fontFamily: "monospace",
    fontSize: "0.82rem",
    whiteSpace: "nowrap",
  };
}

function toggleBtn(on: boolean): React.CSSProperties {
  return {
    background: on ? "#166534" : "#1e293b",
    border: `1px solid ${on ? "#16a34a" : "#334155"}`,
    color: on ? "#4ade80" : "#64748b",
    padding: "0.15rem 0.6rem",
    borderRadius: "0.25rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.75rem",
    minWidth: "3.2rem",
    flexShrink: 0,
  };
}

function wizardRoleBtn(active: boolean): React.CSSProperties {
  return {
    background: active ? "#0f2a4a" : "#0d1420",
    border: `1px solid ${active ? "#3b82f6" : "#1e293b"}`,
    borderRadius: "0.5rem",
    padding: "0.85rem 1rem",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    textAlign: "left",
  };
}

function wizardRegionBtn(active: boolean, child = false): React.CSSProperties {
  return {
    background: active ? "#0f2a4a" : "#0d1420",
    border: `1px solid ${active ? "#3b82f6" : child ? "#0f172a" : "#1e293b"}`,
    borderRadius: "0.375rem",
    padding: "0.65rem 0.85rem",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
    textAlign: "left",
  };
}

function wizardBreadcrumbBtn(active: boolean): React.CSSProperties {
  return {
    background: active ? "#1e3a5f" : "#0d1420",
    border: `1px solid ${active ? "#3b82f6" : "#1e293b"}`,
    color: active ? "#dbeafe" : "#94a3b8",
    padding: "0.2rem 0.55rem",
    borderRadius: "9999px",
    cursor: "pointer",
    fontSize: "0.72rem",
  };
}

function featureBlock(active: boolean): React.CSSProperties {
  return {
    background: active ? "#0f2a1a" : "#0d1420",
    border: `1px solid ${active ? "#166534" : "#1e293b"}`,
    borderRadius: "0.5rem",
    padding: "0.75rem 1rem",
  };
}

const wizardStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    background: "rgba(0,0,0,0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  modal: {
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: "0.5rem",
    width: "90vw",
    maxWidth: "640px",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 16px 48px rgba(0,0,0,0.8)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.65rem 1rem",
    borderBottom: "1px solid #1e293b",
    flexShrink: 0,
  },
  closeBtn: {
    background: "none",
    border: "1px solid #1e293b",
    color: "#64748b",
    cursor: "pointer",
    borderRadius: "0.25rem",
    padding: "0.15rem 0.5rem",
    fontFamily: "monospace",
    fontSize: "0.8rem",
  },
  stepPip: {
    fontSize: "0.65rem",
    padding: "0.1rem 0.5rem",
    borderRadius: "9999px",
    fontFamily: "monospace",
  },
  body: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "1.25rem 1.5rem",
  },
  step: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.25rem",
  },
  stepTitle: {
    color: "#f1f5f9",
    fontSize: "1rem",
    fontWeight: "bold",
  },
  stepSub: {
    color: "#64748b",
    fontSize: "0.8rem",
    marginBottom: "0.25rem",
  },
  nav: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "1.5rem",
    paddingTop: "1rem",
    borderTop: "1px solid #1e293b",
  },
  stepEmpty: {
    marginTop: "1rem",
    padding: "0.85rem 1rem",
    borderRadius: "0.5rem",
    background: "#0d1420",
    border: "1px solid #1e293b",
    color: "#94a3b8",
    fontSize: "0.82rem",
  },
  breadcrumbs: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "0.4rem",
    marginTop: "1rem",
  },
  selectionHint: {
    marginTop: "0.9rem",
    color: "#64748b",
    fontSize: "0.76rem",
  },
};

const styles: Record<string, React.CSSProperties> = {
  page: { padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.5rem" },
  deviceBar: { display: "flex", gap: "0.5rem" },
  empty: { color: "#64748b", fontSize: "0.85rem", padding: "2rem", textAlign: "center" },
  body: { display: "flex", flexDirection: "column", gap: "1.5rem" },
  section: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  sectionTitle: {
    fontSize: "0.65rem",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: "0.75rem",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#0f172a",
    padding: "0.5rem 0.75rem",
    borderBottom: "1px solid #1e293b",
  },
  cardBody: {
    padding: "0.5rem 0.75rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.1rem",
    flex: 1,
  },
  rowKey: { color: "#7a8fa6", width: "13rem", flexShrink: 0, fontSize: "0.78rem" },
  rowVal: { color: "#e2e8f0", wordBreak: "break-all", fontSize: "0.78rem" },
  disabledPill: {
    fontSize: "0.6rem",
    padding: "0.1rem 0.4rem",
    borderRadius: "9999px",
    border: "1px solid #334155",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  editBtn: {
    background: "transparent",
    border: "1px solid #1e293b",
    color: "#64748b",
    padding: "0.1rem 0.5rem",
    borderRadius: "0.25rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.72rem",
  },
  cancelBtn: {
    background: "transparent",
    border: "1px solid #334155",
    color: "#64748b",
    padding: "0.1rem 0.5rem",
    borderRadius: "0.25rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.72rem",
  },
  inputText: {
    background: "#0f172a",
    border: "1px solid #3b82f6",
    color: "#e2e8f0",
    padding: "0.1rem 0.4rem",
    borderRadius: "0.2rem",
    fontFamily: "monospace",
    fontSize: "0.76rem",
    width: "100%",
    outline: "none",
  },
  inputNum: {
    background: "#0f172a",
    border: "1px solid #3b82f6",
    color: "#e2e8f0",
    padding: "0.1rem 0.4rem",
    borderRadius: "0.2rem",
    fontFamily: "monospace",
    fontSize: "0.76rem",
    width: "7rem",
    outline: "none",
  },
  wizardBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#0d1420",
    border: "1px solid #1e293b",
    borderRadius: "0.5rem",
    padding: "0.75rem 1rem",
  },
  wizardBarTitle: { color: "#e2e8f0", fontSize: "0.85rem", fontWeight: "bold" },
  wizardBarSub: { color: "#64748b", fontSize: "0.75rem", marginTop: "0.1rem" },
};
