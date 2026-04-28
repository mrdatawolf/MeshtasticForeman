import { useState, useEffect } from "react";
import type { Message } from "@foreman/shared";
import { foremanClient } from "../ws/client.js";

// ---------------------------------------------------------------------------
// Module-level store — Map from "other node id" to Message[]
// ---------------------------------------------------------------------------

export const BROADCAST = 0xffffffff;

// Prevent unbounded memory growth: keep only the most recent messages per conversation.
const MAX_MESSAGES_PER_CONVERSATION = 500;

const conversations = new Map<number, Message[]>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function otherNodeId(msg: Message): number {
  // Broadcast messages always go into the shared public channel thread,
  // regardless of which node sent them.
  if (msg.toNodeId === BROADCAST) return BROADCAST;
  return msg.role === "sent" ? msg.toNodeId : msg.fromNodeId;
}

function messageSignature(msg: Message): string {
  return [
    msg.packetId,
    msg.fromNodeId,
    msg.toNodeId,
    msg.channelIndex,
    msg.role,
    msg.text ?? "",
    msg.rxTime,
  ].join(":");
}

function addOrUpdate(msg: Message) {
  const key = otherNodeId(msg);
  const existing = conversations.get(key) ?? [];
  const sig = messageSignature(msg);
  const idx = existing.findIndex((m) => m.id === msg.id || messageSignature(m) === sig);
  if (idx >= 0) {
    const next = [...existing];
    next[idx] = { ...next[idx], ...msg };
    conversations.set(key, next);
  } else {
    const next = [...existing, msg];
    conversations.set(key, next.length > MAX_MESSAGES_PER_CONVERSATION ? next.slice(-MAX_MESSAGES_PER_CONVERSATION) : next);
  }
  notify();
}

// ---------------------------------------------------------------------------
// Init — wire WS events once
// ---------------------------------------------------------------------------

let initialized = false;

export function initMessageStore() {
  if (initialized) return;
  initialized = true;

  foremanClient.on((event) => {
    if (event.type === "message:received") {
      addOrUpdate(event.payload);
    }

    if (event.type === "message:sent") {
      const msg = event.payload;
      const convo = conversations.get(msg.toNodeId);
      if (convo) {
        const sentTime = new Date(msg.rxTime).getTime();
        const optIdx = convo.findIndex(
          (m) =>
            m.id.startsWith("local-") &&
            m.toNodeId === msg.toNodeId &&
            Math.abs(new Date(m.rxTime).getTime() - sentTime) < 5000
        );
        if (optIdx >= 0) {
          const next = [...convo];
          next[optIdx] = msg;
          conversations.set(msg.toNodeId, next);
          notify();
          return;
        }
      }
      addOrUpdate(msg);
    }

    if (event.type === "message:history") {
      // Group by other-node, replace conversation, preserve unsent optimistics
      const grouped = new Map<number, Message[]>();
      for (const msg of event.payload) {
        const key = otherNodeId(msg);
        const arr = grouped.get(key) ?? [];
        arr.push(msg);
        grouped.set(key, arr);
      }
      for (const [key, newMsgs] of grouped) {
        const existing = conversations.get(key) ?? [];
        const optimistic = existing.filter((m) => m.id.startsWith("local-"));
        const deduped = new Map<string, Message>();
        for (const msg of [...newMsgs, ...optimistic]) {
          deduped.set(messageSignature(msg), msg);
        }
        const merged = [...deduped.values()].sort(
          (a, b) => new Date(a.rxTime).getTime() - new Date(b.rxTime).getTime()
        );
        conversations.set(key, merged.length > MAX_MESSAGES_PER_CONVERSATION ? merged.slice(-MAX_MESSAGES_PER_CONVERSATION) : merged);
      }
      notify();
    }

    if (event.type === "message:ack") {
      const { messageId, status, ackAt, ackError } = event.payload;
      for (const [key, msgs] of conversations) {
        const idx = msgs.findIndex((m) => m.id === messageId);
        if (idx >= 0) {
          const next = [...msgs];
          next[idx] = { ...next[idx], ackStatus: status, ackAt, ackError };
          conversations.set(key, next);
          notify();
          break;
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Imperative API
// ---------------------------------------------------------------------------

export function addOptimisticMessage(msg: Message) {
  const key = otherNodeId(msg);
  const existing = conversations.get(key) ?? [];
  conversations.set(key, [...existing, msg]);
  notify();
}

export function clearConversation(nodeId: number) {
  conversations.delete(nodeId);
  notify();
}

export function loadRecentMessages(deviceId: string) {
  foremanClient.send({
    type: "messages:request-history",
    payload: { deviceId, limit: 200 },
  });
}

export function loadConversation(deviceId: string, nodeId: number) {
  foremanClient.send({
    type: "messages:request-history",
    payload: { deviceId, toNodeId: nodeId, limit: 100 },
  });
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

export function useConversation(nodeId: number): Message[] {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return conversations.get(nodeId) ?? [];
}

export interface ConversationSummary {
  nodeId: number;
  lastMessage: Message;
}

export function useConversationList(): ConversationSummary[] {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  const result: ConversationSummary[] = [];
  for (const [nodeId, msgs] of conversations) {
    if (msgs.length === 0) continue;
    const last = [...msgs].sort(
      (a, b) => new Date(a.rxTime).getTime() - new Date(b.rxTime).getTime()
    ).at(-1)!;
    result.push({ nodeId, lastMessage: last });
  }
  return result.sort(
    (a, b) =>
      new Date(b.lastMessage.rxTime).getTime() -
      new Date(a.lastMessage.rxTime).getTime()
  );
}
