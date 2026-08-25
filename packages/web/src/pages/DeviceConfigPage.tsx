import { useState, useEffect } from "react";

import { ChannelCards } from "../components/config/ChannelCards.js";
import { ConfigCard } from "../components/config/ConfigCard.js";
import { visibleEntries } from "../components/config/configConstants.js";
import { deviceBtnClass, styles, wizardLaunchBtnClass } from "../components/config/configStyles.js";
import { SetupWizard } from "../components/config/SetupWizard.js";
import { foremanClient } from "../ws/client.js";

import pageStyles from "./DeviceConfigPage.module.css";

import type { DeviceConfig, DeviceInfo } from "@foreman/shared";

interface Props {
  devices: DeviceInfo[];
  configs: Map<string, DeviceConfig>;
  autoOpenWizard?: boolean;
  onWizardOpened?: () => void;
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
    <div className={styles.page}>
      {devices.length > 1 && (
        <div className={styles.deviceBar}>
          {devices.map((d) => (
            <button
              key={d.id}
              className={deviceBtnClass(d.id === selectedId, d.status === "connected")}
              onClick={() => setSelectedId(d.id)}
            >
              <span
                className={
                  d.status === "connected"
                    ? pageStyles.statusConnected
                    : pageStyles.statusDisconnected
                }
              >
                ●
              </span>
              {d.port}
            </button>
          ))}
        </div>
      )}

      {!config ? (
        <div className={styles.empty}>
          {device ? `No config received yet for ${device.port}.` : "No device selected."}
        </div>
      ) : (
        <div className={styles.body}>
          {/* Wizard launcher */}
          <div className={styles.wizardBar}>
            <div>
              <div className={styles.wizardBarTitle}>Setup Wizard</div>
              <div className={styles.wizardBarSub}>
                {deviceConnected
                  ? "Guided role, region, and feature configuration"
                  : "Connect a device to use the setup wizard"}
              </div>
            </div>
            <button
              className={wizardLaunchBtnClass(deviceConnected)}
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
              <div className={styles.cardGrid}>
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
              <div className={styles.cardGrid}>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}
