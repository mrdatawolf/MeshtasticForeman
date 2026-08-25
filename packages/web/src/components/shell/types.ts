export type Tab =
  "nodes" | "map" | "messages" | "activity" | "logs" | "overrides" | "config" | "analytics";
export type MqttScope = "city" | "county" | "state" | "country" | "all";
export type ActivityWindow = "5m" | "15m" | "1h" | "all";
export type ActivitySource = "all" | "mesh" | "mqtt";
export type LogsLevel = "all" | "log" | "warn" | "error";
export type TagFilter = "all" | "devices" | "mqtt" | "ws" | "db" | "foreman";
