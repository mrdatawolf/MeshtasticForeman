import { formatNodeId, resolveNodeName } from "@foreman/shared";
import { useState, useEffect, useRef } from "react";

import { formatRelativeTime } from "../lib/relativeTime.js";
import { useConversation, loadConversation, addOptimisticMessage } from "../store/messages.js";
import { foremanClient } from "../ws/client.js";

import styles from "./NodeDetailPanel.module.css";

import type { NodeInfo, MqttNode, DeviceInfo, Message } from "@foreman/shared";

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

interface Props {
  nodeId: number;
  mesh: NodeInfo | null;
  mqtt: MqttNode | null;
  devices: DeviceInfo[];
  onClose: () => void;
  onMessage?: (nodeId: number) => void;
  onCoverageMap?: (nodeId: number) => void;
}

const HW_MODEL: Record<number, string> = {
  0: "UNSET",
  1: "TLORA_V2",
  2: "TLORA_V1",
  4: "TBEAM",
  8: "T_ECHO",
  10: "RAK4631",
  13: "LILYGO_TBEAM_S3_CORE",
  15: "NANO_G1",
  43: "HELTEC_V3",
  44: "HELTEC_WSL_V3",
  48: "HELTEC_WIRELESS_TRACKER",
  49: "HELTEC_WIRELESS_PAPER",
  50: "T_DECK",
  51: "T_WATCH_S3",
  64: "TRACKER_T1000_E",
  66: "WIO_E5",
  69: "RAK11310",
  70: "RAKWIRELESS_RAK4631",
  71: "STATION_G2",
  89: "TLORA_C6",
  93: "PICOMPUTER_S3",
  94: "HELTEC_HT62",
  95: "HELTEC_WIRELESS_PAPER_V3",
  99: "SEEED_WIO_TRACKER_L1",
  100: "TLORA_T3S3",
  101: "NANO_G2_ULTRA",
  105: "HELTEC_V3_PLUS",
  110: "TBEAM_S3_CORE_V2",
  255: "PRIVATE_HW",
};

function formatLastHeard(iso: string | null) {
  return formatRelativeTime(iso);
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function actionBtnClass(active: boolean, variant?: "danger" | "green" | "pushRight"): string {
  return cx(
    styles.actionBtn,
    active && styles.actionBtnActive,
    variant === "danger" && styles.actionBtnDanger,
    variant === "green" && styles.actionBtnGreen,
    variant === "pushRight" && styles.actionBtnPushRight,
  );
}

export function NodeDetailPanel({
  nodeId,
  mesh,
  mqtt,
  devices,
  onClose,
  onMessage,
  onCoverageMap,
}: Props) {
  const deviceId = devices.find((d) => d.status === "connected")?.id ?? null;
  const primary = mesh ?? mqtt!;

  const messages = useConversation(nodeId);
  const [msgText, setMsgText] = useState("");
  const [channel, setChannel] = useState(0);
  const [sending, setSending] = useState(false);
  const [pendingAction, setPendingAction] = useState<"position" | "traceroute" | "remove" | null>(
    null,
  );
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [traceroute, setTraceroute] = useState<{ route: number[]; routeBack: number[] } | null>(
    null,
  );
  const msgEndRef = useRef<HTMLDivElement>(null);

  // Request message history and listen for traceroute results / node removal
  useEffect(() => {
    if (deviceId) {
      loadConversation(deviceId, nodeId);
    }

    const off = foremanClient.on((event) => {
      if (event.type === "traceroute:result" && event.payload.nodeId === nodeId) {
        setTraceroute({ route: event.payload.route, routeBack: event.payload.routeBack });
        setPendingAction(null);
      }
      if (event.type === "node:removed" && event.payload.nodeId === nodeId) {
        onClose();
      }
    });
    return () => {
      off();
    };
  }, [deviceId, nodeId]);

  // Auto-scroll messages
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function sendMessage() {
    if (!deviceId || !msgText.trim() || sending) return;
    setSending(true);
    foremanClient.send({
      type: "message:send",
      payload: {
        deviceId,
        toNodeId: nodeId,
        text: msgText.trim(),
        channelIndex: channel,
        wantAck: true,
      },
    });
    // Optimistic local message
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
      role: "sent" as const,
      ackStatus: "pending" as const,
      ackAt: null,
      ackError: null,
      replyToPacketId: 0,
    };
    addOptimisticMessage(optimistic);
    setMsgText("");
    setTimeout(() => {
      setSending(false);
    }, 5000);
  }

  function requestPosition() {
    if (!deviceId) return;
    setPendingAction("position");
    foremanClient.send({ type: "node:request-position", payload: { deviceId, nodeId } });
    setTimeout(() => setPendingAction(null), 15000);
  }

  function requestTraceroute() {
    if (!deviceId) return;
    setPendingAction("traceroute");
    setTraceroute(null);
    foremanClient.send({ type: "node:traceroute", payload: { deviceId, nodeId } });
    setTimeout(() => setPendingAction(null), 30000);
  }

  function removeNode() {
    if (!deviceId) return;
    setConfirmRemove(false);
    setPendingAction("remove");
    foremanClient.send({ type: "node:remove", payload: { deviceId, nodeId } });
    setTimeout(() => setPendingAction(null), 10000);
  }

  const isMqttOnly = !mesh;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <div className={styles.headerName}>
              {resolveNodeName(nodeId, primary, { fallback: "Unknown" })}
            </div>
            <div className={styles.headerSub}>
              <span className={styles.mono}>{formatNodeId(nodeId)}</span>
              {primary.shortName && primary.longName && (
                <span className={styles.shortNameHint}>({primary.shortName})</span>
              )}
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {/* Details grid */}
          <div className={styles.detailGrid}>
            <Detail label="Node ID" value={formatNodeId(nodeId)} mono />
            <Detail
              label="Hardware"
              value={
                primary.hwModel != null ? (HW_MODEL[primary.hwModel] ?? `#${primary.hwModel}`) : "—"
              }
            />
            <Detail label="Last Heard" value={formatLastHeard(primary.lastHeard)} />
            <Detail
              label="SNR"
              value={primary.snr != null ? `${primary.snr.toFixed(1)} dB` : "—"}
            />
            {mesh && (
              <Detail
                label="Hops Away"
                value={
                  mesh.hopsAway != null
                    ? mesh.hopsAway === 0
                      ? "Direct"
                      : `${mesh.hopsAway} hop${mesh.hopsAway > 1 ? "s" : ""}`
                    : "—"
                }
              />
            )}
            {primary.latitude != null && (
              <Detail label="Latitude" value={primary.latitude.toFixed(6)} mono />
            )}
            {primary.longitude != null && (
              <Detail label="Longitude" value={primary.longitude.toFixed(6)} mono />
            )}
            {primary.altitude != null && (
              <Detail label="Altitude" value={`${primary.altitude} m`} />
            )}
            {mesh?.macAddress && <Detail label="MAC" value={mesh.macAddress} mono />}
            {mesh?.publicKey && (
              <Detail label="Public Key" value={mesh.publicKey.slice(0, 16) + "…"} mono />
            )}
            {mqtt?.lastGateway && <Detail label="MQTT Gateway" value={mqtt.lastGateway} />}
            {mqtt?.distanceM != null && (
              <Detail
                label="MQTT Distance"
                value={
                  mqtt.distanceM < 1000
                    ? `${Math.round(mqtt.distanceM)} m`
                    : `${(mqtt.distanceM / 1000).toFixed(1)} km`
                }
              />
            )}
            {mqtt?.regionPath && <Detail label="Region" value={mqtt.regionPath} />}
          </div>

          {/* Actions */}
          {deviceId && !isMqttOnly && (
            <div className={styles.actions}>
              <button
                className={actionBtnClass(pendingAction === "position")}
                disabled={!!pendingAction}
                onClick={requestPosition}
              >
                {pendingAction === "position" ? "Requesting…" : "📍 Request Position"}
              </button>
              <button
                className={actionBtnClass(pendingAction === "traceroute")}
                disabled={!!pendingAction}
                onClick={requestTraceroute}
              >
                {pendingAction === "traceroute" ? "Tracing…" : "🔍 Traceroute"}
              </button>
              {onMessage && (
                <button
                  className={actionBtnClass(false)}
                  onClick={() => {
                    onClose();
                    onMessage(nodeId);
                  }}
                >
                  ✉ Messages Tab
                </button>
              )}
              {confirmRemove ? (
                <>
                  <button className={actionBtnClass(false, "danger")} onClick={removeNode}>
                    Confirm Reset
                  </button>
                  <button className={actionBtnClass(false)} onClick={() => setConfirmRemove(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className={actionBtnClass(pendingAction === "remove", "pushRight")}
                  disabled={!!pendingAction}
                  onClick={() => setConfirmRemove(true)}
                  title="Remove from radio nodeDB and clear local cache"
                >
                  {pendingAction === "remove" ? "Removing…" : "Reset Node"}
                </button>
              )}
            </div>
          )}

          {/* Coverage map — available for any node with GPS, regardless of connection state */}
          {onCoverageMap && primary.latitude != null && primary.longitude != null && (
            <div className={cx(styles.actions, styles.actionsSpaced)}>
              <button
                className={actionBtnClass(false, "green")}
                onClick={() => {
                  onClose();
                  onCoverageMap(nodeId);
                }}
              >
                🗺 Coverage Map
              </button>
            </div>
          )}

          {/* Traceroute result */}
          {traceroute && (
            <div className={styles.traceResult}>
              <span className={styles.routeLabel}>Route: </span>
              {traceroute.route.length === 0
                ? "Direct"
                : traceroute.route.map((id) => formatNodeId(id)).join(" → ")}
              {traceroute.routeBack.length > 0 && (
                <span className={styles.routeBackLabel}>
                  ← {traceroute.routeBack.map((id) => formatNodeId(id)).join(" ← ")}
                </span>
              )}
            </div>
          )}

          {/* Messages */}
          {deviceId && !isMqttOnly && (
            <>
              <div className={styles.sectionLabel}>Messages</div>
              <div className={styles.messageList}>
                {messages.length === 0 ? (
                  <div className={styles.noMessages}>No messages with this node.</div>
                ) : (
                  messages.map((m) => {
                    const outgoing = m.role === "sent";
                    return (
                      <div
                        key={m.id}
                        className={cx(styles.msgBubble, outgoing && styles.msgBubbleOutgoing)}
                      >
                        {m.role === "relayed" && <div className={styles.relayedLabel}>relayed</div>}
                        <div
                          className={cx(
                            styles.msgText,
                            m.role === "relayed" && styles.msgTextRelayed,
                          )}
                        >
                          {m.text ?? <em className={styles.encryptedHint}>encrypted</em>}
                        </div>
                        <div className={styles.msgMeta}>
                          {formatTime(m.rxTime)}
                          {m.rxSnr != null && ` · SNR ${m.rxSnr.toFixed(1)}`}
                          {m.viaMqtt && " · MQTT"}
                          {outgoing && m.ackStatus === "pending" && (
                            <span className={styles.ackPending} title="Waiting for ACK">
                              ⏳
                            </span>
                          )}
                          {outgoing && m.ackStatus === "acked" && (
                            <span className={styles.ackOk} title="Delivered">
                              ✓
                            </span>
                          )}
                          {outgoing && m.ackStatus === "error" && (
                            <span className={styles.ackErr} title={m.ackError ?? "Delivery failed"}>
                              ✗
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={msgEndRef} />
              </div>

              {/* Compose */}
              <div className={styles.compose}>
                <select
                  className={styles.channelSelect}
                  value={channel}
                  onChange={(e) => setChannel(Number(e.target.value))}
                  title="Channel"
                >
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                    <option key={i} value={i}>
                      Ch {i}
                    </option>
                  ))}
                </select>
                <input
                  className={styles.msgInput}
                  placeholder="Send a message…"
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  maxLength={228}
                />
                <button
                  className={cx(
                    styles.sendBtn,
                    (sending || !msgText.trim()) && styles.sendBtnDisabled,
                  )}
                  disabled={sending || !msgText.trim()}
                  onClick={sendMessage}
                >
                  {sending ? "…" : "Send"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <span className={styles.detailLabel}>{label}</span>
      <span className={cx(styles.detailValue, mono && styles.detailValueMono)}>{value}</span>
    </>
  );
}
