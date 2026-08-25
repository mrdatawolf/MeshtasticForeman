import { resolveNodeName } from "@foreman/shared";
import { lazy, Suspense } from "react";

import { cx, rangeBtnClass, styles } from "./analyticsStyles.js";

import type { MqttNode, NodeInfo } from "@foreman/shared";
import type React from "react";
import type { CSSProperties } from "react";

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

// ---------------------------------------------------------------------------
// Recharts dark-theme constants
//
// These are config objects fed to recharts props (`tick`, `wrapperStyle`,
// the Tooltip `contentStyle`/`labelStyle`/`itemStyle` props), not DOM
// `style`/`className` attributes we render ourselves — recharts' own
// TypeScript definitions (`XAxis`'s `tick?: TickProp<...>`, `Tooltip`'s
// `contentStyle?: CSSProperties` etc., `Legend`'s `wrapperStyle?:
// CSSProperties`) only accept plain objects/CSSProperties here, with no
// `className` alternative, so these stay as-is (same library-constraint
// category as MapPage's react-map-gl `style` props, see TASK-022b).
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
/** Legend's `wrapperStyle` prop — same library constraint as above. */
export const LEGEND_WRAPPER_STYLE: CSSProperties = {
  fontSize: "0.7rem",
  fontFamily: "monospace",
  color: "#94a3b8",
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
    <div className={cx(styles.card, fullWidth && styles.cardFullWidth)}>
      <div className={styles.cardTitle}>{title}</div>
      {children}
    </div>
  );
}

export function Empty({ message = "No data" }: { message?: string }) {
  return <div className={styles.empty}>{message}</div>;
}

export function Loading({ height }: { height?: number } = {}) {
  return (
    <div
      className={styles.empty}
      style={{ "--loading-height": `${height ?? 160}px` } as CSSProperties}
    >
      <div className={styles.spinner} />
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
    <div className={styles.rangeBtnRow}>
      {options.map((o) => (
        <button key={o} className={rangeBtnClass(value === o)} onClick={() => onChange(o)}>
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
  const heightVar = { "--mesh-height": `${height}px` } as CSSProperties;
  if (graphData.nodes.length === 0) {
    return (
      <div className={styles.meshPlaceholder} style={heightVar}>
        {emptyMessage}
      </div>
    );
  }
  return (
    <Suspense
      fallback={
        <div className={styles.meshPlaceholder} style={heightVar}>
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
