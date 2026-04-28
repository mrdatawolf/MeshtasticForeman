import { useState, useRef, useEffect, useCallback } from "react";
import type { DeviceInfo, NodeInfo, MqttNode, Message } from "@foreman/shared";
import { foremanClient } from "../ws/client.js";
import {
  useConversationList,
  useConversation,
  loadConversation,
  addOptimisticMessage,
  BROADCAST,
} from "../store/messages.js";

interface Props {
  devices: DeviceInfo[];
  nodes: NodeInfo[];
  mqttNodes: MqttNode[];
  initialNodeId?: number | null;
  onInitialNodeConsumed?: () => void;
}

function nodeHex(nodeId: number) {
  return `!${nodeId.toString(16).padStart(8, "0")}`;
}

function nodeName(
  nodeId: number,
  nodes: NodeInfo[],
  mqttNodes: MqttNode[]
): string {
  if (nodeId === BROADCAST) return "Public Channel";
  const mesh = nodes.find((n) => n.nodeId === nodeId);
  if (mesh?.shortName) return mesh.shortName;
  if (mesh?.longName) return mesh.longName;
  const mqtt = mqttNodes.find((n) => n.nodeId === nodeId);
  if (mqtt?.shortName) return mqtt.shortName;
  if (mqtt?.longName) return mqtt.longName;
  return nodeHex(nodeId);
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function truncate(text: string | null, max: number): string {
  if (!text) return "(encrypted)";
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

// ─── Thread view ─────────────────────────────────────────────────────────────

interface ThreadProps {
  nodeId: number;
  nodes: NodeInfo[];
  mqttNodes: MqttNode[];
  deviceId: string;
}

function ThreadView({ nodeId, nodes, mqttNodes, deviceId }: ThreadProps) {
  const messages = useConversation(nodeId);
  const [msgText, setMsgText] = useState("");
  const [channel, setChannel] = useState(0);
  const [sending, setSending] = useState(false);
  const msgEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConversation(deviceId, nodeId);
  }, [deviceId, nodeId]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function sendMessage() {
    if (!msgText.trim() || sending) return;
    setSending(true);
    foremanClient.send({
      type: "message:send",
      payload: { deviceId, toNodeId: nodeId, text: msgText.trim(), channelIndex: channel, wantAck: true },
    });
    const optimistic: Message = {
      id: `local-${Date.now()}`,
      packetId: 0,
      fromNodeId: 0,
      toNodeId: nodeId,
      channelIndex: channel,
      text: msgText.trim(),
      rxTime: new Date().toISOString(),
      rxSnr: null,
      rxRssi: null,
      hopLimit: null,
      wantAck: true,
      viaMqtt: false,
      role: "sent",
      ackStatus: "pending",
      ackAt: null,
      ackError: null,
      replyToPacketId: 0,
    };
    addOptimisticMessage(optimistic);
    setMsgText("");
    setTimeout(() => setSending(false), 5000);
  }

  const name = nodeName(nodeId, nodes, mqttNodes);
  const isBroadcast = nodeId === BROADCAST;

  // Build a packetId → message index for reply lookups (broadcast only).
  const byPacketId = isBroadcast
    ? new Map(messages.filter((m) => m.packetId !== 0).map((m) => [m.packetId, m]))
    : null;

  // Split into top-level messages and replies.
  // A reply is any message with replyToPacketId !== 0 whose parent is in the
  // current window. Orphaned replies (parent pruned) are shown as top-level.
  const replyChildren = isBroadcast
    ? (() => {
        const map = new Map<string, Message[]>();
        for (const m of messages) {
          if (m.replyToPacketId !== 0 && byPacketId?.has(m.replyToPacketId)) {
            const parent = byPacketId.get(m.replyToPacketId)!;
            const bucket = map.get(parent.id) ?? [];
            bucket.push(m);
            map.set(parent.id, bucket);
          }
        }
        return map;
      })()
    : null;

  const isInlineReply = (m: Message) =>
    isBroadcast && m.replyToPacketId !== 0 && byPacketId?.has(m.replyToPacketId);

  function renderBubble(m: Message, indent = false) {
    const outgoing = m.role === "sent";
    return (
      <div key={m.id} style={{ ...bubbleWrapStyle(outgoing), paddingLeft: indent ? "2rem" : 0 }}>
        {indent && <div style={styles.replyConnector} />}
        <div style={bubbleStyle(outgoing, m.role === "relayed", indent)}>
          {m.role === "relayed" && (
            <div style={styles.relayedLabel}>relayed</div>
          )}
          {isBroadcast && !outgoing && (
            <div style={styles.senderLabel}>
              {nodeName(m.fromNodeId, nodes, mqttNodes)}
            </div>
          )}
          {indent && (
            <div style={styles.replyingToLabel}>
              ↩ replying to {nodeName(
                byPacketId?.get(m.replyToPacketId)?.fromNodeId ?? m.replyToPacketId,
                nodes, mqttNodes
              )}
            </div>
          )}
          <div style={{ ...styles.msgText, opacity: m.role === "relayed" ? 0.5 : 1 }}>
            {m.text ?? <em style={{ color: "#475569" }}>encrypted</em>}
          </div>
          <div style={styles.msgMeta}>
            {formatTime(m.rxTime)}
            {m.rxSnr != null && ` · SNR ${m.rxSnr.toFixed(1)}`}
            {m.viaMqtt && " · MQTT"}
            {outgoing && m.ackStatus === "pending" && (
              <span style={styles.ackPending} title="Waiting for ACK">⏳</span>
            )}
            {outgoing && m.ackStatus === "acked" && (
              <span style={styles.ackOk} title="Delivered">✓</span>
            )}
            {outgoing && m.ackStatus === "error" && (
              <span style={styles.ackErr} title={m.ackError ?? "Delivery failed"}>✗</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.thread}>
      <div style={styles.threadHeader}>
        <span style={styles.threadName}>{name}</span>
        {nodeId !== BROADCAST && (
          <span style={styles.threadHex}>{nodeHex(nodeId)}</span>
        )}
      </div>

      <div style={styles.messageList}>
        {messages.length === 0 ? (
          <div style={styles.empty}>No messages yet.</div>
        ) : (
          messages
            .filter((m) => !isInlineReply(m))
            .map((m) => (
              <div key={m.id}>
                {renderBubble(m, false)}
                {replyChildren?.get(m.id)?.map((r) => renderBubble(r, true))}
              </div>
            ))
        )}
        <div ref={msgEndRef} />
      </div>

      <div style={styles.compose}>
        <select
          style={styles.channelSelect}
          value={channel}
          onChange={(e) => setChannel(Number(e.target.value))}
          title="Channel"
        >
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <option key={i} value={i}>Ch {i}</option>
          ))}
        </select>
        <input
          style={styles.msgInput}
          placeholder="Send a message…"
          value={msgText}
          onChange={(e) => setMsgText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
          }}
          maxLength={228}
        />
        <button
          style={sendBtnStyle(sending || !msgText.trim())}
          disabled={sending || !msgText.trim()}
          onClick={sendMessage}
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function MessagesPage({ devices, nodes, mqttNodes, initialNodeId, onInitialNodeConsumed }: Props) {
  const conversations = useConversationList();
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const deviceId = devices.find((d) => d.status === "connected")?.id ?? null;

  // Honour external navigation (e.g. "✉ Msg" from Nodes page)
  useEffect(() => {
    if (initialNodeId != null) {
      setSelectedNodeId(initialNodeId);
      onInitialNodeConsumed?.();
    }
  }, [initialNodeId, onInitialNodeConsumed]);

  // Auto-select first conversation when list first populates (only if nothing targeted)
  useEffect(() => {
    if (selectedNodeId == null && conversations.length > 0) {
      setSelectedNodeId(conversations[0].nodeId);
    }
  }, [conversations, selectedNodeId]);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

  const openConversation = useCallback((nodeId: number) => {
    setSelectedNodeId(nodeId);
    setPickerOpen(false);
    if (deviceId) loadConversation(deviceId, nodeId);
  }, [deviceId]);

  // Mesh nodes sorted by most-recently-heard for the picker
  const meshNodesSorted = [...nodes].sort((a, b) => {
    if (!a.lastHeard) return 1;
    if (!b.lastHeard) return -1;
    return new Date(b.lastHeard).getTime() - new Date(a.lastHeard).getTime();
  });

  return (
    <div style={styles.page}>
      {/* Left: conversation list */}
      <div style={styles.sidebar}>
        {/* Header row is outside the scrollable area so the picker dropdown can overflow freely */}
        <div style={styles.sidebarHeaderRow}>
          <span style={styles.sidebarHeader}>Conversations</span>
          {deviceId && (
            <div ref={pickerRef} style={{ position: "relative" }}>
              <button style={newBtnStyle(pickerOpen)} onClick={() => setPickerOpen((v) => !v)} title="Start a new conversation">
                + New
              </button>
              {pickerOpen && (
                <div style={styles.picker}>
                  <div style={styles.pickerLabel}>Local mesh nodes</div>
                  {meshNodesSorted.length === 0 ? (
                    <div style={styles.pickerEmpty}>No mesh nodes seen yet.</div>
                  ) : (
                    meshNodesSorted.map((n) => (
                      <button
                        key={n.nodeId}
                        style={pickerRowStyle(n.nodeId === selectedNodeId)}
                        onClick={() => openConversation(n.nodeId)}
                      >
                        <span style={styles.pickerName}>{n.shortName ?? n.longName ?? nodeHex(n.nodeId)}</span>
                        {n.longName && n.shortName && (
                          <span style={styles.pickerSub}>{n.longName}</span>
                        )}
                        <span style={styles.pickerHex}>{nodeHex(n.nodeId)}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div style={styles.sidebarList}>
          {conversations.length === 0 ? (
            <div style={styles.empty}>No conversations yet.</div>
          ) : (
            conversations.map(({ nodeId, lastMessage }) => {
              const name = nodeName(nodeId, nodes, mqttNodes);
              const active = nodeId === selectedNodeId;
              return (
                <button
                  key={nodeId}
                  style={convoRowStyle(active)}
                  onClick={() => setSelectedNodeId(nodeId)}
                >
                  <div style={styles.convoName}>{name}</div>
                  <div style={styles.convoPreview}>{truncate(lastMessage.text, 40)}</div>
                  <div style={styles.convoTime}>{formatTime(lastMessage.rxTime)}</div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right: thread */}
      <div style={styles.threadPane}>
        {selectedNodeId != null && deviceId != null ? (
          <ThreadView
            key={selectedNodeId}
            nodeId={selectedNodeId}
            nodes={nodes}
            mqttNodes={mqttNodes}
            deviceId={deviceId}
          />
        ) : (
          <div style={styles.placeholder}>
            {deviceId == null
              ? "No device connected."
              : "Select a conversation."}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function bubbleWrapStyle(outgoing: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: outgoing ? "flex-end" : "flex-start",
  };
}

function bubbleStyle(outgoing: boolean, relayed: boolean, reply = false): React.CSSProperties {
  return {
    maxWidth: "72%",
    background: relayed ? "#0f172a" : outgoing ? "#1e3a5f" : "#1e293b",
    border: `1px solid ${relayed ? "#1e293b" : reply ? "#7c3aed" : outgoing ? "#2563eb" : "#334155"}`,
    borderRadius: "0.5rem",
    padding: "0.45rem 0.7rem",
    opacity: relayed ? 0.7 : 1,
  };
}

function newBtnStyle(open: boolean): React.CSSProperties {
  return {
    background: open ? "#1e3a5f" : "#1e293b",
    border: `1px solid ${open ? "#3b82f6" : "#334155"}`,
    color: open ? "#60a5fa" : "#94a3b8",
    padding: "0.15rem 0.5rem",
    borderRadius: "0.3rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.72rem",
  };
}

function pickerRowStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "baseline",
    gap: "0.3rem",
    width: "100%",
    background: active ? "#1e3a5f" : "transparent",
    border: "none",
    color: "inherit",
    cursor: "pointer",
    textAlign: "left",
    padding: "0.45rem 0.75rem",
    borderBottom: "1px solid #0f172a",
  };
}

function convoRowStyle(active: boolean): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    background: active ? "#1e3a5f" : "transparent",
    border: `1px solid ${active ? "#3b82f6" : "transparent"}`,
    borderRadius: "0.375rem",
    color: "inherit",
    cursor: "pointer",
    textAlign: "left",
    padding: "0.55rem 0.75rem",
    marginBottom: "0.2rem",
  };
}

function sendBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? "#1e293b" : "#1d4ed8",
    border: "none",
    color: disabled ? "#475569" : "#fff",
    padding: "0.4rem 0.9rem",
    borderRadius: "0.375rem",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "monospace",
    fontSize: "0.8rem",
    flexShrink: 0,
  };
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    height: "100%",
    overflow: "hidden",
  },
  sidebar: {
    width: "260px",
    flexShrink: 0,
    borderRight: "1px solid #1e293b",
    display: "flex",
    flexDirection: "column",
    // No overflow here — keeps the picker dropdown from being clipped
  },
  sidebarList: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "0 0.5rem 0.75rem",
  },
  sidebarHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.75rem 0.75rem 0.5rem",
    flexShrink: 0,
  },
  sidebarHeader: {
    color: "#334155",
    fontSize: "0.65rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
  picker: {
    position: "absolute" as const,
    top: "calc(100% + 0.3rem)",
    left: 0,
    width: "220px",
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: "0.4rem",
    boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
    zIndex: 50,
    overflow: "hidden",
  },
  pickerLabel: {
    color: "#334155",
    fontSize: "0.62rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    padding: "0.5rem 0.75rem 0.3rem",
  },
  pickerEmpty: {
    color: "#475569",
    fontSize: "0.75rem",
    padding: "0.5rem 0.75rem 0.75rem",
  },
  pickerName: {
    color: "#e2e8f0",
    fontWeight: "bold",
    fontSize: "0.82rem",
  },
  pickerSub: {
    color: "#64748b",
    fontSize: "0.72rem",
    marginLeft: "0.4rem",
  },
  pickerHex: {
    color: "#334155",
    fontFamily: "monospace",
    fontSize: "0.68rem",
    marginLeft: "auto",
  },
  threadPane: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  thread: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  threadHeader: {
    padding: "0.75rem 1.25rem",
    borderBottom: "1px solid #1e293b",
    flexShrink: 0,
    display: "flex",
    alignItems: "baseline",
    gap: "0.75rem",
  },
  threadName: {
    color: "#f1f5f9",
    fontWeight: "bold",
    fontSize: "0.95rem",
  },
  threadHex: {
    color: "#475569",
    fontSize: "0.78rem",
    fontFamily: "monospace",
  },
  messageList: {
    flex: 1,
    overflowY: "auto",
    padding: "1rem 1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
  },
  msgText: {
    color: "#e2e8f0",
    fontSize: "0.83rem",
    lineHeight: "1.45",
  },
  msgMeta: {
    color: "#475569",
    fontSize: "0.68rem",
    marginTop: "0.2rem",
    display: "flex",
    alignItems: "center",
    gap: "0.3rem",
  },
  relayedLabel: {
    color: "#475569",
    fontSize: "0.62rem",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: "0.15rem",
  },
  replyConnector: {
    width: "1px",
    alignSelf: "stretch",
    background: "#7c3aed",
    opacity: 0.4,
    marginRight: "0.5rem",
    flexShrink: 0,
  },
  replyingToLabel: {
    color: "#7c3aed",
    fontSize: "0.62rem",
    marginBottom: "0.2rem",
    opacity: 0.85,
  },
  senderLabel: {
    color: "#60a5fa",
    fontSize: "0.7rem",
    fontWeight: "bold",
    marginBottom: "0.15rem",
  },
  ackPending: {
    fontSize: "0.7rem",
    opacity: 0.6,
  },
  ackOk: {
    color: "#22c55e",
    fontSize: "0.75rem",
  },
  ackErr: {
    color: "#ef4444",
    fontSize: "0.75rem",
    cursor: "help",
  },
  compose: {
    display: "flex",
    gap: "0.4rem",
    alignItems: "center",
    padding: "0.75rem 1.25rem",
    borderTop: "1px solid #1e293b",
    flexShrink: 0,
  },
  channelSelect: {
    background: "#1e293b",
    border: "1px solid #334155",
    color: "#94a3b8",
    borderRadius: "0.375rem",
    padding: "0.4rem 0.3rem",
    fontFamily: "monospace",
    fontSize: "0.75rem",
    flexShrink: 0,
  },
  msgInput: {
    flex: 1,
    background: "#1e293b",
    border: "1px solid #334155",
    color: "#e2e8f0",
    borderRadius: "0.375rem",
    padding: "0.4rem 0.6rem",
    fontFamily: "monospace",
    fontSize: "0.8rem",
    outline: "none",
  },
  convoName: {
    color: "#e2e8f0",
    fontWeight: "bold",
    fontSize: "0.82rem",
    marginBottom: "0.15rem",
  },
  convoPreview: {
    color: "#64748b",
    fontSize: "0.74rem",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    marginBottom: "0.15rem",
  },
  convoTime: {
    color: "#334155",
    fontSize: "0.68rem",
  },
  empty: {
    color: "#334155",
    fontSize: "0.8rem",
    textAlign: "center",
    padding: "2rem 0",
  },
  placeholder: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#334155",
    fontSize: "0.85rem",
  },
};
