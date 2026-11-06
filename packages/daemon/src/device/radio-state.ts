import { RADIO_RESPONSE_WINDOW_MS } from "./raw-probe.js";

import type { ConnectionFacts } from "./device-manager.js";

export type RadioState = "not-held" | "no-request" | "answered" | "waiting" | "silent";

/**
 * The CONTRACT-013 "radio responding" rule. Silence alone never counts against
 * the radio, because a healthy radio can be silent. Only a request with no reply does.
 * The window counts from the first unanswered request, so the watchdog's repeat
 * requests cannot turn a hung radio's `fail` back into `warn`.
 */
export function radioState(
  facts: Pick<ConnectionFacts, "portHeld" | "lastConfigRequestAt" | "unansweredSinceAt">,
  nowMs: number,
): RadioState {
  if (!facts.portHeld) return "not-held";
  if (facts.lastConfigRequestAt === null) return "no-request";
  if (facts.unansweredSinceAt === null) return "answered";
  const waitedMs = nowMs - Date.parse(facts.unansweredSinceAt);
  return waitedMs < RADIO_RESPONSE_WINDOW_MS ? "waiting" : "silent";
}
