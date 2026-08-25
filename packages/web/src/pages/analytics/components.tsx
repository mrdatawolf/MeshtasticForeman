import { resolveNodeName } from "@foreman/shared";
import { lazy, Suspense } from "react";

import type { MqttNode, NodeInfo } from "@foreman/shared";
import type React from "react";

const ForceGraph2D = lazy(() => import("react-force-graph-2d"));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function nodeName(id: number, nodes: NodeInfo[], mqttNodes: MqttNode[]): string {
  const n = (nodes as Array<NodeInfo | MqttNode>).concat(mqttNodes).find((x) => x.nodeId === id);
  return resolveNodeName(id, n ?? {});
}

/** Deterministic HSL colour from a node ID — same hashing as MapPage. */
export function nodeColor(id: number): string {
  const h = Math.round((id * 137.508) % 360);
  return `hsl(${h},65%,60%)`;
}

/** SNR → link colour for the neighbor graph. */
export function snrLinkColor(snr: number | null): string {
  if (snr === null) return "#475569";
  if (snr > 0) return "#22c55e";
  if (snr > -5) return "#84cc16";
  if (snr > -10) return "#f59e0b";
  if (snr > -15) return "#f97316";
  return "#ef4444";
}

/** SNR → link width (1–4 px). */
export function snrLinkWidth(snr: number | null): number {
  if (snr === null) return 1;
  return Math.max(1, Math.min(4, (snr + 20) / 5));
}

export function formatTs(ts: string, bucket = "hour"): string {
  const d = new Date(ts);
  if (bucket === "day") return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export const MAP_STYLE =
  import.meta.env.VITE_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty";

// Inject a single keyframe rule for the loading spinner (once per page load).
if (typeof document !== "undefined" && !document.getElementById("analytics-spinner-kf")) {
  const s = document.createElement("style");
  s.id = "analytics-spinner-kf";
  s.textContent =
    "@keyframes analytics-spin{to{transform:rotate(360deg)}}" +
    ".analytics-spinner{width:22px;height:22px;border:2px solid #1e293b;" +
    "border-top-color:#3b82f6;border-radius:50%;" +
    "animation:analytics-spin 0.75s linear infinite}";
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Recharts dark-theme constants
// ---------------------------------------------------------------------------

export const GRID_COLOR = "#1e293b";
export const TICK_STYLE = { fill: "#64748b", fontSize: 11, fontFamily: "monospace" };
export const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "0.375rem",
    fontFamily: "monospace",
    fontSize: "0.75rem",
  },
  labelStyle: { color: "#94a3b8" },
  itemStyle: { color: "#e2e8f0" },
};

export const ROLE_COLORS = { received: "#60a5fa", sent: "#34d399", relayed: "#a78bfa" };
export const PIE_PALETTE = [
  "#60a5fa",
  "#34d399",
  "#a78bfa",
  "#fb923c",
  "#fbbf24",
  "#f87171",
  "#94a3b8",
  "#22d3ee",
  "#e879f9",
  "#4ade80",
];

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

export function ChartCard({
  title,
  children,
  fullWidth,
}: {
  title: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div style={{ ...styles.card, gridColumn: fullWidth ? "1 / -1" : undefined }}>
      <div style={styles.cardTitle}>{title}</div>
      {children}
    </div>
  );
}

export function Empty({ message = "No data" }: { message?: string }) {
  return <div style={styles.empty}>{message}</div>;
}

export function Loading({ height }: { height?: number } = {}) {
  return (
    <div style={{ ...styles.empty, height: height ?? 160 }}>
      <div className="analytics-spinner" />
    </div>
  );
}

export function RangeBtn({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.6rem" }}>
      {options.map((o) => (
        <button key={o} style={rangeStyle(value === o)} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared: Force-graph canvas component
// ---------------------------------------------------------------------------

export function MeshGraph({
  graphData,
  graphWidth,
  height = 420,
  emptyMessage = "No data in this window",
}: {
  graphData: { nodes: unknown[]; links: unknown[] };
  graphWidth: number;
  height?: number;
  emptyMessage?: string;
}) {
  if (graphData.nodes.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#475569",
          fontSize: "0.75rem",
        }}
      >
        {emptyMessage}
      </div>
    );
  }
  return (
    <Suspense
      fallback={
        <div
          style={{
            height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#475569",
            fontSize: "0.75rem",
          }}
        >
          Loading graph…
        </div>
      }
    >
      <ForceGraph2D
        graphData={graphData as Parameters<typeof ForceGraph2D>[0]["graphData"]}
        width={graphWidth}
        height={height}
        backgroundColor="#020617"
        nodeLabel="name"
        nodeColor={(n: Record<string, unknown>) => (n.color as string | undefined) ?? "#60a5fa"}
        linkColor={(l: Record<string, unknown>) => (l.color as string | undefined) ?? "#334155"}
        linkWidth={(l: Record<string, unknown>) => (l.width as number | undefined) ?? 1}
        nodeCanvasObjectMode={() => "after"}
        nodeCanvasObject={(
          node: { x?: number; y?: number; name?: string },
          ctx: CanvasRenderingContext2D,
          globalScale: number,
        ) => {
          if (!node.name || node.x == null || node.y == null) return;
          const fontSize = Math.max(10, 12 / globalScale);
          ctx.font = `${fontSize}px monospace`;
          ctx.fillStyle = "#94a3b8";
          ctx.textAlign = "center";
          ctx.fillText(node.name, node.x, node.y + 10);
        }}
      />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
function rangeStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "#1e3a5f" : "#0f172a",
    color: active ? "#60a5fa" : "#64748b",
    border: `1px solid ${active ? "#3b82f6" : "#1e293b"}`,
    padding: "0.15rem 0.5rem",
    borderRadius: "0.25rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.72rem",
  };
}

export const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "1rem 1.5rem",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    boxSizing: "border-box",
    overflowY: "auto",
  },
  subNav: {
    display: "flex",
    gap: "0.1rem",
    borderBottom: "1px solid #1e293b",
    marginBottom: "1rem",
    flexShrink: 0,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "1rem",
    alignItems: "start",
  },
  card: {
    background: "#0f172a",
    borderRadius: "0.5rem",
    padding: "1rem",
    border: "1px solid #1e293b",
  },
  cardTitle: {
    fontSize: "0.7rem",
    fontWeight: "bold",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#64748b",
    paddingBottom: "0.5rem",
    borderBottom: "1px solid #1e293b",
    marginBottom: "0.75rem",
  },
  empty: {
    height: "160px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#475569",
    fontSize: "0.75rem",
    fontFamily: "monospace",
  },
  legendWrap: {
    fontSize: "0.7rem",
    fontFamily: "monospace",
    color: "#94a3b8",
  },
  subLabel: {
    fontSize: "0.65rem",
    fontWeight: "bold",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "#475569",
    marginBottom: "0.3rem",
    marginTop: "0.5rem",
  },
  errorRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "0.72rem",
    fontFamily: "monospace",
    padding: "0.1rem 0",
  },
  deliverySummary: {
    fontSize: "0.72rem",
    fontFamily: "monospace",
    color: "#94a3b8",
    marginBottom: "0.25rem",
  },
  latencySummary: {
    display: "flex",
    gap: "1.5rem",
    fontSize: "0.72rem",
    fontFamily: "monospace",
    color: "#64748b",
    marginBottom: "0.5rem",
  },
  matrixCorner: {
    padding: "0.2rem 0.4rem",
    background: "#020617",
  },
  matrixHeader: {
    padding: "0.2rem 0.4rem",
    textAlign: "center" as const,
    color: "#94a3b8",
    background: "#020617",
    borderBottom: "1px solid #1e293b",
    fontWeight: "normal",
    whiteSpace: "nowrap" as const,
    maxWidth: "5rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  matrixRowHeader: {
    padding: "0.2rem 0.5rem",
    color: "#94a3b8",
    background: "#020617",
    borderRight: "1px solid #1e293b",
    whiteSpace: "nowrap" as const,
    maxWidth: "8rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  matrixCell: {
    padding: "0.2rem 0.4rem",
    textAlign: "center" as const,
    fontSize: "0.62rem",
    color: "#64748b",
    border: "1px solid #0f172a",
  },
  logCell: {
    padding: "0.25rem 0.5rem",
    color: "#94a3b8",
    whiteSpace: "nowrap" as const,
  },
};
