export type ParsedInboundTopic =
  | { kind: "encrypted"; channelName: string; gatewayId: string; regionPath: string }
  | { kind: "json"; channelName: string; gatewayId: string; regionPath: string }
  | { kind: "skip" };

export function parseInboundTopic(topic: string): ParsedInboundTopic {
  const parts = topic.split("/");
  const jsonIdx = parts.indexOf("json");
  if (jsonIdx !== -1 && parts[jsonIdx - 1] === "2") {
    return {
      kind: "json",
      channelName: parts[jsonIdx + 1] ?? "unknown",
      gatewayId: parts[jsonIdx + 2] ?? "unknown",
      regionPath: parts
        .slice(1, jsonIdx - 1)
        .filter(Boolean)
        .join("/"),
    };
  }

  const eIdx = parts.indexOf("e");
  if (eIdx === -1 || parts[eIdx - 1] !== "2") return { kind: "skip" };
  return {
    kind: "encrypted",
    channelName: parts[eIdx + 1] ?? "LongFast",
    gatewayId: parts[eIdx + 2] ?? "unknown",
    // Filter empty segments for missing city levels (for example CentralCoast//2/e/...).
    regionPath: parts
      .slice(1, eIdx - 1)
      .filter(Boolean)
      .join("/"),
  };
}
