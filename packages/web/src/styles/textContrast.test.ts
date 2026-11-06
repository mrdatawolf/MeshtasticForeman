import { describe, expect, it } from "vitest";

import { hslLuminance, nodeFillLabelColor, nodeLabelColor } from "../lib/nodeLabelColor.js";

function readSources(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([path, source]) => [path.replace(/^\.\.?\//, ""), source]),
  );
}

const cssFiles = readSources(
  import.meta.glob<string>("../**/*.css", { query: "?raw", import: "default", eager: true }),
);
const sourceFiles = readSources(
  import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.*"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

const TEXT_MIN = 4.5;
const DISABLED_MIN = 3;

/** Opaque dark surfaces that text sits on. */
const DARK_SURFACES = [
  "#020617",
  "#080f1a",
  "#0a0f1a",
  "#0d1420",
  "#0f172a",
  "#0f2a1a",
  "#0f2a4a",
  "#052e16",
  "#1e293b",
  "#1e3a5f",
  "#334155",
];
/** #0f172acc panels over a white basemap, the worst case for map overlays. */
const MAP_PANEL_WORST_CASE = "#3f4555";
const ACCENT_FILLS = ["#3b82f6", "#22c55e", "#ef4444"];
const LIGHT_SURFACES = ["#ffffff", "#f8fafc"];
const LIGHT_BUTTON = "#f1f5f9";
const PAGE = "#0f172a";
const PANEL = "#1e293b";

/**
 * Status colours that are below 4.5:1 on a specific background. The task keeps
 * status colours and backgrounds unchanged, so these are recorded, not fixed.
 * Remove an entry when the pair is resolved. The test fails on stale entries.
 */
const KNOWN_STATUS_FAILURES = new Set([
  "#ef4444 on #1e293b", // red status text and "Delete" on panels: 3.89
  "#ef4444 on #1e3a5f", // failed-send mark on outgoing bubbles: 3.06
  "#4ade80 on #166534", // "On" toggle in the MQTT menu and config editor: 4.09
  "#dc2626 on #f1f5f9", // "Delete Proposal" in the light map popup: 4.41
]);

/**
 * Every opacity below 1 that can affect text. Each was measured in the running
 * app. Adding a new one means checking the dimmed text still meets its target.
 */
const REVIEWED_OPACITY = new Set([
  "components/config/configStyles.module.css 0.75", // inactive config card
  "components/shell/GpsMenu.module.css 0.7", // disabled refresh button
  "pages/MapPage.module.css 0.6", // dashed legend line, no text
  "pages/MessagesPage.tsx 0.75", // relayed bubble
  "pages/MessagesPage.tsx 0.4", // reply connector line, no text
  "pages/NodeOverridesPage.tsx 0.5", // disabled input
  "pages/NodesPage.tsx 0.7", // inactive sort arrows and section caret glyphs
  "pages/NodesPage.tsx 0.15", // empty-state logo image, no text
]);

function hexToRgb(hex: string): [number, number, number] {
  const full =
    hex.length === 4
      ? hex
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("")
      : hex.slice(1, 7);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratioOf(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function contrast(foreground: string, background: string): number {
  return ratioOf(luminance(foreground), luminance(background));
}

const tokensCss = cssFiles["tokens.css"];
const tokens = new Map(
  [...tokensCss.matchAll(/(--text-[a-z-]+):\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => [m[1], m[2]]),
);

function token(name: string): string {
  const value = tokens.get(name);
  if (!value) throw new Error(`Unknown token ${name}`);
  return value;
}

/** Resolves a colour value to hex. Returns null for values judged elsewhere. */
function resolve(value: string): string | null {
  const variable = value.match(/^var\((--text-[a-z-]+)\)$/);
  if (variable) return token(variable[1]);
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value.toLowerCase() : null;
}

interface Finding {
  where: string;
  pair: string;
  ratio: number;
}

/** Declarations that sit on a known surface other than the default for their file. */
const KNOWN_SURFACES: Record<string, string> = {
  "components/shell/AppShell.module.css .mdA": PAGE,
  "pages/NodeDetailPanel.module.css .ackErr": "#1e3a5f",
};

/** The surface a declaration sits on when its own rule sets no background. */
function defaultSurface(file: string): string {
  return /popupStyles|ProposalEditor/.test(file) ? LIGHT_BUTTON : PANEL;
}

function checkColour(
  findings: Finding[],
  where: string,
  value: string,
  ownBackground: string | null,
  file: string,
): number {
  const foreground = resolve(value);
  if (!foreground) return 0;
  // Tokens are proven against every surface below, so only their fills need a
  // pair check. `--text-on-light*` tokens are also covered there.
  if (value.startsWith("var(") && !ownBackground) return 1;
  const background = ownBackground ?? KNOWN_SURFACES[where] ?? defaultSurface(file);
  const minimum = value === "var(--text-disabled)" ? DISABLED_MIN : TEXT_MIN;
  const ratio = contrast(foreground, background);
  if (ratio < minimum) findings.push({ where, pair: `${foreground} on ${background}`, ratio });
  return 1;
}

function auditCss(): { findings: Finding[]; checked: number } {
  const findings: Finding[] = [];
  let checked = 0;
  for (const [file, raw] of Object.entries(cssFiles)) {
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim();
      const body = rule[2];
      const background = body.match(/(?:^|[\s;])background(?:-color)?:\s*(#[0-9a-fA-F]{6})\b/);
      for (const declaration of body.matchAll(/(?:^|[\s;])color:\s*([^;!]+)/g)) {
        checked += checkColour(
          findings,
          `${file} ${selector}`,
          declaration[1].trim(),
          background?.[1].toLowerCase() ?? null,
          file,
        );
      }
    }
  }
  return { findings, checked };
}

/** Lines that use `color:` for something other than text. */
const NON_TEXT_LINE = /properties:|links\.push|\{ label: "[^"]+", color:/;

function auditSources(): { findings: Finding[]; checked: number } {
  const findings: Finding[] = [];
  let checked = 0;
  for (const [file, source] of Object.entries(sourceFiles)) {
    source.split("\n").forEach((line, index) => {
      if (NON_TEXT_LINE.test(line)) return;
      const isText =
        /(?:^|[\s{,])color: /.test(line) ||
        /fillStyle =/.test(line) ||
        /"--(?:marker-fg|stack-color)"/.test(line);
      if (!isText) return;
      for (const literal of line.matchAll(/"(#[0-9a-fA-F]{3,8}|var\(--text-[a-z-]+\))"/g)) {
        const background = /fillStyle =/.test(line) ? "#020617" : null;
        checked += checkColour(findings, `${file}:${index + 1}`, literal[1], background, file);
      }
    });
  }
  return { findings, checked };
}

function failures(findings: Finding[]): string[] {
  return findings
    .filter((finding) => !KNOWN_STATUS_FAILURES.has(finding.pair))
    .map((finding) => `${finding.where}: ${finding.pair} = ${finding.ratio.toFixed(2)}`);
}

describe("text colour tokens", () => {
  it.each(["--text-primary", "--text-secondary", "--text-muted"])(
    "%s meets 4.5:1 on every opaque dark surface",
    (name) => {
      for (const surface of DARK_SURFACES) {
        expect(contrast(token(name), surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(
          TEXT_MIN,
        );
      }
    },
  );

  it("--text-secondary stays readable on translucent map panels", () => {
    expect(contrast(token("--text-secondary"), MAP_PANEL_WORST_CASE)).toBeGreaterThanOrEqual(
      TEXT_MIN,
    );
  });

  it("--text-disabled meets 3:1 where controls are disabled and stays distinct", () => {
    for (const surface of [PAGE, PANEL]) {
      const ratio = contrast(token("--text-disabled"), surface);
      expect(ratio).toBeGreaterThanOrEqual(DISABLED_MIN);
      expect(contrast(token("--text-muted"), surface) / ratio).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("--text-on-accent meets 4.5:1 on every saturated fill", () => {
    for (const fill of ACCENT_FILLS) {
      expect(contrast(token("--text-on-accent"), fill)).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it.each(["--text-on-light", "--text-on-light-secondary", "--text-on-light-muted"])(
    "%s meets 4.5:1 on the light popup surfaces",
    (name) => {
      for (const surface of LIGHT_SURFACES) {
        expect(contrast(token(name), surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(
          TEXT_MIN,
        );
      }
    },
  );
});

describe("text colours in packages/web/src", () => {
  it("CSS has no failing text colour outside the recorded status pairs", () => {
    const { findings, checked } = auditCss();
    expect(checked).toBeGreaterThan(200);
    expect(failures(findings)).toEqual([]);
  });

  it("TS and TSX have no failing text colour outside the recorded status pairs", () => {
    const { findings, checked } = auditSources();
    expect(checked).toBeGreaterThan(80);
    expect(failures(findings)).toEqual([]);
  });

  it("records only status pairs that still exist", () => {
    const found = new Set([...auditCss().findings, ...auditSources().findings].map((f) => f.pair));
    expect([...KNOWN_STATUS_FAILURES].filter((pair) => !found.has(pair))).toEqual([]);
  });

  it("every opacity below 1 that can affect text has been reviewed", () => {
    const found = new Set<string>();
    const all = { ...cssFiles, ...sourceFiles };
    for (const [file, raw] of Object.entries(all)) {
      for (const match of raw.matchAll(/(?:^|[\s{,?:])opacity:[^;\n,}]*/gm)) {
        for (const value of match[0].matchAll(/\b0?\.\d+/g)) found.add(`${file} ${value[0]}`);
      }
    }
    expect([...found].filter((entry) => !REVIEWED_OPACITY.has(entry))).toEqual([]);
  });
});

describe("node label colours", () => {
  it("every marker hue gets a readable label on the dark marker background", () => {
    const background = luminance("#0f172a");
    for (let hue = 0; hue < 360; hue += 0.5) {
      const match = nodeLabelColor(hue).match(/hsl\((.+), (\d+)%, (\d+)%\)/);
      expect(match).not.toBeNull();
      const label = hslLuminance(Number(match![1]), Number(match![2]), Number(match![3]));
      expect(ratioOf(label, background), `hue ${hue}`).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it("every filled marker hue gets a readable label", () => {
    for (let hue = 0; hue < 360; hue += 0.5) {
      const fill = hslLuminance(hue, 70, 55);
      const label = nodeFillLabelColor(hue) === "#000" ? 0 : 1;
      expect(ratioOf(label, fill), `hue ${hue}`).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });
});
