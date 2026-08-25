import {
  featureBlockClass,
  navBtnClass,
  styles,
  toggleBtnClass,
  wizardStyles,
} from "./configStyles.js";
import localStyles from "./FeaturesStep.module.css";

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
    <div className={localStyles.fieldRow}>
      <span className={localStyles.fieldLabel}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={styles.inputText}
      />
    </div>
  );
}

export function FeaturesStep({
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
    <div className={wizardStyles.step}>
      <div className={wizardStyles.stepTitle}>Optional features</div>
      <div className={wizardStyles.stepSub}>
        Enable any combination. You can change these later via the config cards.
      </div>

      <div className={localStyles.list}>
        {/* MQTT */}
        <div className={featureBlockClass(mqttEnabled)}>
          <div className={localStyles.fieldRow}>
            <button
              className={toggleBtnClass(mqttEnabled)}
              onClick={() => setMqttEnabled(!mqttEnabled)}
            >
              {mqttEnabled ? "ON" : "OFF"}
            </button>
            <div>
              <div className={localStyles.featureTitle}>MQTT uplink</div>
              <div className={localStyles.featureDesc}>Forward mesh traffic to an MQTT broker</div>
            </div>
          </div>
          {mqttEnabled && (
            <div className={localStyles.mqttFields}>
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
        <div className={featureBlockClass(neighborInfo)}>
          <div className={localStyles.fieldRow}>
            <button
              className={toggleBtnClass(neighborInfo)}
              onClick={() => setNeighborInfo(!neighborInfo)}
            >
              {neighborInfo ? "ON" : "OFF"}
            </button>
            <div>
              <div className={localStyles.featureTitle}>Neighbor Info</div>
              <div className={localStyles.featureDesc}>
                Broadcasts heard-neighbor list every 15 min — required for the Network graph
              </div>
            </div>
          </div>
        </div>

        {/* Store & Forward — only meaningful for router/client */}
        {(role === 0 || role === 2 || role === 3) && (
          <div className={featureBlockClass(storeForward)}>
            <div className={localStyles.fieldRow}>
              <button
                className={toggleBtnClass(storeForward)}
                onClick={() => setStoreForward(!storeForward)}
              >
                {storeForward ? "ON" : "OFF"}
              </button>
              <div>
                <div className={localStyles.featureTitle}>Store & Forward server</div>
                <div className={localStyles.featureDesc}>
                  Cache and replay missed messages — best on well-connected nodes
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={wizardStyles.nav}>
        <button className={navBtnClass(false)} onClick={onBack}>
          ← Back
        </button>
        <button className={navBtnClass(false)} onClick={onNext}>
          Review →
        </button>
      </div>
    </div>
  );
}
