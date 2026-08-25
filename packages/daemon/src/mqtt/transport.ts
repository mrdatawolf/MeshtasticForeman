import { randomBytes } from "node:crypto";

import mqtt from "mqtt";

export interface TransportConfig {
  broker: string;
  port: number;
  username: string;
  password: string;
  rootTopic: string;
}

export function connectTransport(cfg: TransportConfig): mqtt.MqttClient {
  const url = `mqtt://${cfg.broker}:${cfg.port}`;
  const clientId = `foreman_${randomBytes(4).toString("hex")}`;
  const client = mqtt.connect(url, {
    username: cfg.username,
    password: cfg.password,
    clientId,
    reconnectPeriod: 5000,
    keepalive: 60,
  });
  console.log(`[mqtt] connecting as clientId=${clientId}`);
  return client;
}

export function subscribeTransport(client: mqtt.MqttClient, rootTopic: string): void {
  // Regions use inconsistent depths (centralvalley = 4 levels, Humboldt/Eureka = 5 levels,
  // CentralCoast// = 5 levels with empty city) so a fixed +/+/2/e/# pattern misses some.
  // _handleInbound already finds 2/e by searching, so a broad # subscription is safe.
  // Special value "all" subscribes to every topic on the broker.
  const subTopic = rootTopic === "all" ? "#" : `${rootTopic}/#`;
  client.subscribe(subTopic, (err) => {
    if (err) console.error("[mqtt] subscribe error:", err.message);
    else console.log(`[mqtt] subscribed to ${subTopic}`);
  });
}

export function stopTransport(client: mqtt.MqttClient | null): void {
  client?.end(true); // force-close so reconnectPeriod doesn't restart it
}
