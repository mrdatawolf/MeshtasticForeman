import { useState, useEffect, useRef } from "react";

import type { LogEntry } from "@foreman/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

type TagFilter = "all" | "devices" | "mqtt" | "ws" | "db" | "foreman";

const LEVEL_COLORS: Record<string, string> = {
  log: "#94a3b8",
  warn: "#fbbf24",
  error: "#f87171",
};

const TAG_COLORS: Record<string, string> = {
  devices: "#60a5fa",
  mqtt: "#34d399",
  ws: "#a78bfa",
  db: "#fb923c",
  foreman: "#94a3b8",
};

function tagColor(tag: string): string {
  return TAG_COLORS[tag] ?? "#64748b";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  entries: LogEntry[];
  levelFilter: "all" | "log" | "warn" | "error";
  tagFilter: TagFilter;
  paused: boolean;
  setPaused: (fn: (p: boolean) => boolean) => void;
}

export function LogsPage({ entries, levelFilter, tagFilter, paused }: Props) {
  const [frozen, setFrozen] = useState<LogEntry[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  // Snapshot entries when pausing; clear when resuming
  useEffect(() => {
    if (paused) setFrozen(applyFilters(entries));
    else setFrozen([]);
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = (list: LogEntry[]) =>
    list.filter((e) => {
      if (levelFilter !== "all" && e.level !== levelFilter) return false;
      if (tagFilter !== "all" && e.tag !== tagFilter) return false;
      return true;
    });

  const displayEntries = applyFilters(paused ? frozen : entries);

  useEffect(() => {
    if (!paused && autoScroll.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [displayEntries.length, paused]);

  return (
    <div style={styles.page}>
      {/* Feed */}
      <div
        ref={feedRef}
        style={styles.feed}
        onMouseEnter={() => {
          autoScroll.current = false;
        }}
        onMouseLeave={() => {
          autoScroll.current = true;
        }}
      >
        {displayEntries.map((e) => (
          <div key={e.id} style={styles.row}>
            <span style={styles.time}>{formatTime(e.ts)}</span>
            {e.tag && <span style={{ ...styles.tag, color: tagColor(e.tag) }}>[{e.tag}]</span>}
            <span style={{ ...styles.text, color: LEVEL_COLORS[e.level] ?? "#94a3b8" }}>
              {e.tag ? e.text.replace(`[${e.tag}]`, "").trimStart() : e.text}
            </span>
          </div>
        ))}
        {displayEntries.length === 0 && (
          <div style={{ color: "#475569", padding: "1rem", textAlign: "center" }}>No log lines</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "0.75rem 1.5rem",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    boxSizing: "border-box",
  },
  feed: {
    flex: 1,
    overflowY: "auto",
    fontFamily: "monospace",
    fontSize: "0.72rem",
    display: "flex",
    flexDirection: "column",
    background: "#0a0f1a",
    borderRadius: "0.4rem",
    padding: "0.4rem 0.6rem",
  },
  row: {
    display: "flex",
    gap: "0.6rem",
    padding: "0.1rem 0",
    alignItems: "flex-start",
    borderBottom: "1px solid #0f172a",
  },
  time: { color: "#334155", flexShrink: 0, width: "5.5rem" },
  tag: { flexShrink: 0, fontWeight: "bold", width: "5.5rem" },
  text: { flex: 1, whiteSpace: "pre-wrap", wordBreak: "break-all" },
};
