/**
 * Readable label colours for map nodes. Each node gets a hue from its ID, and at
 * the marker's lightness some of those hues fail as text. CSS tokens cannot help
 * because the colour is per node, so labels use a lighter tint of the same hue.
 */

/** Text colour for a node label on the dark marker background. */
export function nodeLabelColor(hue: number): string {
  return `hsl(${hue}, 70%, 75%)`;
}

/** WCAG relative luminance of an `hsl(hue, saturation, lightness)` colour. */
export function hslLuminance(hue: number, saturation: number, lightness: number): number {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): number => {
    const k = (n + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

/**
 * Text colour for a label on a filled marker, whose fill is `hsl(hue, 70%, 55%)`.
 * Black or white, whichever contrasts more: one of them always reaches 4.5:1.
 */
export function nodeFillLabelColor(hue: number): string {
  const fill = hslLuminance(hue, 70, 55);
  const onWhite = 1.05 / (fill + 0.05);
  const onBlack = (fill + 0.05) / 0.05;
  return onBlack >= onWhite ? "#000" : "#fff";
}
