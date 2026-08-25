# ADR-004: Current multi-device support stance

Status: Proposed
Date:
Decision owners:
Related tasks and contracts: TASK-034 (this ADR is retrospective
documentation, not a new decision); `docs/ROADMAP.md` product-roadmap item
"Multiple devices per daemon"

## Context

`packages/daemon/src/device/device-manager.ts`'s `DeviceManager` owns all
physical Meshtastic device connections for the daemon process. This ADR
documents the multi-device support that actually exists in the code today,
so that "does the daemon support more than one device?" has a recorded,
accurate answer instead of being re-litigated or assumed each time it comes
up.

`docs/ROADMAP.md`'s product roadmap lists, as an in-progress/exploring item
not yet complete:

> **Multiple devices per daemon** — support more than one connected device
> without mixing per-device state.

This ADR does not decide that roadmap item. It documents the current state
the roadmap item is building on.

## Decision

The current stance has two layers that do not fully agree with each other,
and this ADR records both honestly rather than simplifying to either
"single-device" or "multi-device":

**The device-connection and persistence layer already supports multiple
simultaneous devices, scoped by `device_id`.** `DeviceManager` stores
connections in a `Map<string, ConnectedDevice>` keyed by a generated device
id, and `connect(port, name)` can be called multiple times for different
ports to attach more than one device concurrently — this is exercised
directly in `packages/daemon/src/__tests__/device-manager.test.ts` (e.g. a
test connecting `/dev/ttyUSB0` and `/dev/ttyUSB1` as two devices and
asserting that a `node_id` seen on both stays in two separate rows). Every
mesh-local table in the schema (`nodes`, `messages`, `packets`, `channels`,
`traceroutes`, `position_history`) has a `device_id` foreign key and is
queried/written per device, so this isn't an accident of the in-memory map —
the DB schema was built with multiple devices in mind. `reconnectSaved()`
reconnects every device row saved in the DB from a previous run, not just
one. The web frontend also has multi-device surfaces already:
`DeviceMenu.tsx` renders a device list, and `DeviceConfigPage.tsx` shows a
device picker when `devices.length > 1`.

**Despite that, the documented/default operational path connects exactly one
device, and known cross-cutting state is not device-scoped.** The primary
startup path (`MESHTASTIC_PORT`/`MESHTASTIC_NAME` env vars, singular, no
default — see `packages/daemon/src/config.ts` and
`packages/daemon/src/index.ts`) auto-connects one device at startup;
attaching a second device requires an explicit `POST /api/devices/connect`
call rather than being part of the documented single-device setup flow. More
concretely, the `MqttGateway`'s remote-node table, `mqtt_nodes`, has no
`device_id` column at all — it is a single global table shared across every
attached device, unlike the mesh-local tables above. And
`MqttGateway._getOwnLatLon()` (used to anchor Haversine distance
calculations for every remote MQTT node) returns "the cached lat/lon of the
first attached device that has a GPS fix" — a single shared reference point,
not one per device. If two devices with different physical locations were
attached to the same daemon, MQTT-derived distance data would be anchored to
whichever device's position was cached first, not to each device
individually. This is precisely the kind of "mixing per-device state" the
roadmap item names as still-open work.

In short: the mesh-local data layer already isolates state per device and is
exercised that way in tests, but the MQTT layer's cross-cutting state does
not follow the same isolation, and the product's documented/default
configuration is one device per daemon. Multi-device operation is technically
reachable today but is not the verified, supported product configuration.

## Alternatives considered

Not applicable in the usual ADR sense — this document describes the current
state as found in the code rather than a choice between constructed
alternatives. The roadmap item this ADR relates to ("Multiple devices per
daemon") is the recorded direction for closing the gap described above; it
remains a future, undecided product decision, not an alternative evaluated
here.

## Consequences

### Benefits (of the current state)

- Because the mesh-local persistence layer is already `device_id`-scoped,
  work to fully support multiple devices does not require a data-model
  migration for `nodes`/`messages`/`packets`/`channels`/`traceroutes`/
  `position_history` — the schema and `DeviceManager` API already anticipate
  it.
- A single-device deployment (the common case today) is simple to configure
  via one `MESHTASTIC_PORT` env var, with no user-facing complexity from
  multi-device concerns.

### Costs and risks

- Anyone attaching a second device today (via `POST /api/devices/connect`,
  or because two devices were saved from a previous run and both get
  reconnected by `reconnectSaved()`) gets an environment where mesh-local
  data is correctly isolated per device, but MQTT remote-node data
  (`mqtt_nodes`) and MQTT distance-anchoring (`_getOwnLatLon()`) are not —
  this could silently produce misleading distance data or merge remote-node
  visibility across devices without any error or warning.
- Because this configuration is reachable without being the supported
  product path, it could be exercised unintentionally (e.g. a saved device
  row from testing) without anyone realizing the MQTT-layer gaps apply.

## Open questions

- Is today's ability to call `connect()` more than once, with correctly
  isolated mesh-local data, meant to be read as a *partial* implementation
  of "Multiple devices per daemon" — such that the roadmap item is really
  about closing the specific known gaps identified here (`mqtt_nodes`
  device-scoping, the `_getOwnLatLon()` single-device heuristic) — or is it
  incidental engineering flexibility in `DeviceManager` that happens to work
  for the mesh-local case but was never intended to be relied on for
  multi-device use until the roadmap item is explicitly decided? This ADR
  does not resolve that question; it only records the concrete evidence
  (device-scoped schema and tests vs. non-device-scoped MQTT state) behind
  the roadmap item's phrasing, "without mixing per-device state."

## Follow-up work

None decided by this ADR. `docs/ROADMAP.md`'s "Multiple devices per daemon"
product-roadmap item is the known future direction for resolving the gap
this ADR documents, and remains undecided. `docs/ROADMAP.md`'s
maintainability track also lists "Record architectural decisions for major
choices such as ... multi-device support" as the item this ADR satisfies.
