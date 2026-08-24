# Product roadmap readiness assessment (2026-08-24)

This is not an ADR — it records no decision — but lives in `docs/decisions/`
because, like an ADR, it should stay in the repository rather than only in
chat history. It captures Jarvis's readiness assessment of `docs/ROADMAP.md`'s
"Product roadmap" section, produced alongside the Stage 1-6 "Maintainability
roadmap" decomposition into TASK-001 through TASK-035 (see `tasks/README.md`).

The product roadmap section is framed by `docs/ROADMAP.md` itself as
exploratory ideas, not commitments. Per that framing, these items were
deliberately **not** forced into `tasks/proposed/` task files. Each is
assessed below for whether it's ready to become a task now, or needs a
Jarvis design/scoping pass first.

## Most ready to scope now

**Traceroute visualization** — ready to scope now. `traceroute:result` events
(`{deviceId, nodeId, route, routeBack}`, arrays of node numbers) already flow
to the frontend and are already rendered as text in `NodeDetailPanel.tsx` and
as a topology graph in `AnalyticsPage.tsx` — but never drawn on the map
itself, which is the actual gap this roadmap item names. Data source, event,
and display surface (`MapPage.tsx`) all already exist. Recommend sequencing
after TASK-019 (MapPage split) lands, so it's built against the split
map-layer modules rather than the monolith.

## Close, but one real design question first

**Message delivery confirmation** — `message:ack` (status/ackAt/ackError)
already exists and is already surfaced in `MessagesPage.tsx`/`store/messages.ts`
for direct serial delivery. But the roadmap's actual ask — "combine MQTT data
with the message system to create a back-channel" — requires deciding how an
MQTT-observed packet gets correlated back to a specific pending message
without false positives, a real architectural question. Recommend a short
Jarvis scoping pass focused specifically on that correlation question before
writing the task.

## Needs a Jarvis design/scoping pass before a task can be written

- **Cross-mesh relay** — no defined scope; relay-selection semantics and
  protocol implications are undefined.
- **Ping data** — the existing `message-latency`/`link-quality` analytics
  endpoints measure message-delivery latency, not device round-trip/
  connectivity ping, and `MapPage.tsx`'s existing "ping"-labeled action is
  actually a position request, not a real ping. What "ping" should mean here
  is genuinely undefined.
- **Node list improvements** — "improve organization and presentation" has no
  defined scope; likely an `interface-designer`-led UX exploration once
  scoped.
- **Message system stability** — framed as ongoing hardening, not a single
  feature; likely becomes several small Stage-2/Stage-5-style hardening tasks
  once the human decides what "stability" gaps matter most.
- **Multi-device MQTT messages** (decrypting other devices' messages via
  private channel keys) — technically plausible given the MQTT gateway's
  existing PSK-decryption code, but has a real privacy/policy dimension
  (decrypting traffic that isn't this operator's own) needing an explicit
  human decision before any scoping, not just a technical design pass.
- **Multiple devices per daemon** — the most architecturally significant
  product idea on this list. Some plumbing already anticipates it (`deviceId`
  threaded through nearly everything, `Map<string, DeviceState>` in the MQTT
  gateway), but this is a large cross-cutting architecture change
  (DeviceManager, MqttGateway, DB schema, WS protocol, UI device switcher)
  requiring a full Jarvis architecture pass and almost certainly its own ADR,
  not a single task.

## Longer-term ideas

Terrain-aware coverage phase 2, scalable topology graph, and long-term
telemetry storage are correctly framed by the roadmap itself as needing more
groundwork (elevation data strategy; force-directed graph library evaluation;
measuring actual PGlite retention/query performance per TASK-032's data
before deciding whether a time-series database is warranted). None are ready
for task decomposition. The telemetry-storage idea specifically depends on
TASK-032 (retention/pruning policies) shipping first so there is real data to
evaluate.
