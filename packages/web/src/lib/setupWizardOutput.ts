export interface ConfigChange {
  namespace: "radio" | "module";
  section: string;
  value: Record<string, unknown>;
}

export interface WizardMqttInput {
  enabled: boolean;
  address: string;
  user: string;
  pass: string;
}

/** Construct the ordered device-config writes emitted by the setup wizard. */
export function buildWizardChanges(
  role: number | null,
  regionSettings: Record<string, unknown>,
  mqtt: WizardMqttInput,
  neighborInfo: boolean,
  storeForward: boolean,
): ConfigChange[] {
  const changes = new Map<string, ConfigChange>();

  function add(namespace: "radio" | "module", section: string, values: Record<string, unknown>) {
    const key = `${namespace}.${section}`;
    const existing = changes.get(key);
    changes.set(
      key,
      existing
        ? { namespace, section, value: { ...existing.value, ...values } }
        : { namespace, section, value: values },
    );
  }

  if (role !== null) add("radio", "device", { role });

  for (const [namespace, sections] of Object.entries(regionSettings)) {
    if (!sections || typeof sections !== "object") continue;
    for (const [section, values] of Object.entries(sections as Record<string, unknown>)) {
      if (values && typeof values === "object" && !Array.isArray(values)) {
        add(namespace as "radio" | "module", section, values as Record<string, unknown>);
      }
    }
  }

  if (mqtt.enabled) {
    const values: Record<string, unknown> = {
      enabled: true,
      encryptionEnabled: true,
      proxyToClientEnabled: true,
    };
    if (mqtt.address) values.address = mqtt.address;
    if (mqtt.user) values.username = mqtt.user;
    if (mqtt.pass) values.password = mqtt.pass;
    add("module", "mqtt", values);
  }
  if (neighborInfo) add("module", "neighborInfo", { enabled: true, updateInterval: 900 });
  if (storeForward) {
    add("module", "storeForward", { enabled: true, isServer: true, heartbeat: true });
  }

  return [...changes.values()];
}
