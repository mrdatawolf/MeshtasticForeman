# ADR-003: MQTT bridging design

Status: Proposed
Date:
Decision owners:
Related tasks and contracts: TASK-034 (this ADR is retrospective
documentation, not a new decision)

## Context

Some Meshtastic hardware (the header comment in
`packages/daemon/src/mqtt/gateway.ts` names nRF52-based devices such as the
Seeed Wio Tracker L1) has no WiFi and cannot connect to MQTT on its own. The
daemon's `MqttGateway` (`packages/daemon/src/mqtt/gateway.ts`) bridges such a
device's mesh traffic to an MQTT broker on its behalf, "mirror[ing] what a
WiFi-capable Meshtastic device would do natively," per the file's own header
comment.

`docs/ARCHITECTURE.md`'s existing "MQTT gateway" section describes this
behavior at a summary level (topic structure, re-encryption, 15-minute
re-announce). That description was checked against `gateway.ts` while
drafting this ADR and matches the current implementation; this ADR expands on
it with the detail needed to explain *why* the design looks the way it does,
without duplicating the architecture doc's role as the summary reference.

This ADR records the design already implemented — it does not propose an
alternative or reopen the choice.

## Decision

When `MQTT_BROKER` is configured, the daemon's `MqttGateway`:

- **Publishes outbound traffic under Meshtastic's own topic and encryption
  conventions**, not a Foreman-specific format:
  - Encrypted `ServiceEnvelope` protobufs (all mesh traffic) to
    `{root}/2/e/{channel}/{!gatewayId}`.
  - Unencrypted `ServiceEnvelope` protobufs carrying `MapReport` to
    `{root}/2/map/`.
- **Re-encrypts decoded packets** before publishing: a packet the connected
  device already decrypted locally is re-encrypted with the channel's AES key
  (AES-128-CTR, nonce built from the packet id and sending node number) so it
  is opaque on the wire exactly as it would be coming from a native
  WiFi-enabled node. A packet that arrived already encrypted (couldn't be
  decrypted locally) is passed through unchanged. Packets that arrived via
  MQTT downlink (`pkt.viaMqtt`) are never re-published, to avoid loops.
- **Subscribes broadly** (`{root}/#`, or `#` if `rootTopic` is the special
  value `"all"`) rather than to a fixed-depth pattern, because — per the
  in-code comment — regional topic trees have inconsistent depths (e.g.
  `centralvalley` uses 4 levels, `Humboldt/Eureka` uses 5, `CentralCoast`
  uses 5 with an empty city segment). Inbound handling locates the `2/e` or
  `2/json` segment by searching the topic's parts rather than assuming a
  fixed position.
- **Self-announces periodically**: once both the device's own node number and
  at least one channel are known, it schedules an announce 2 seconds later,
  then repeats on `selfAnnounceInterval` (config field, default 15 minutes —
  matching `docs/ARCHITECTURE.md`), publishing `NODEINFO_APP`, `POSITION_APP`
  (if a position is cached), and an unencrypted `MAP_REPORT_APP` to
  `{root}/2/map/`. It also piggybacks an extra announce (rate-limited to once
  per 5 minutes) on relay traffic, and once more immediately after acquiring
  its first GPS fix, so remote instances don't have to wait a full interval
  to see the gateway node or its location.
- **Decrypts and records inbound remote-node data** into a dedicated
  `mqtt_nodes` table, separate from the mesh-local `nodes` table populated by
  `DeviceManager`. For encrypted inbound packets it searches all currently
  attached devices' known channels for a name match to find the decryption
  key, falling back to the well-known public default Meshtastic channel PSK
  (`DEFAULT_KEY`) if none matches. It also accepts a JSON-encoded inbound
  format (`{root}/2/json/...`) as a separate code path
  (`_handleJsonInbound`).
- **Computes distance** from the local device's own position to each remote
  MQTT node using the Haversine formula, both incrementally
  (`_upsertFromData`) and via a rate-limited bulk recalculation
  (`_recalcAllDistances`, at most once per 5 minutes) whenever the local
  device's own position updates.

## Alternatives considered

This is a retrospective ADR; the alternatives actually weighed at
implementation time are not recorded elsewhere in the repository. Two
alternatives can be grounded directly in the code's own framing (the header
comment: "Mirrors what a WiFi-capable Meshtastic device would do natively")
as choices the implemented design forecloses, though this ADR does not claim
they were explicitly litigated:

- **Publish decrypted plaintext instead of re-encrypting.** Simpler to
  implement, but would not interoperate with the existing Meshtastic MQTT
  ecosystem (regional brokers, the official Meshtastic map, other Meshtastic
  clients), which expects the standard encrypted `ServiceEnvelope` wire
  format.
- **Define a Foreman-specific topic structure** instead of matching
  Meshtastic's own (`2/e/{channel}/{!gatewayId}`, `2/map/`). Would decouple
  Foreman from Meshtastic's topic conventions, but would break
  interoperability with the same existing ecosystem — other clients and
  brokers would not recognize Foreman's traffic as standard Meshtastic
  traffic.

## Consequences

### Benefits

- Devices without native WiFi (e.g. nRF52-based hardware) gain full
  participation in the wider Meshtastic MQTT mesh — regional map, other
  gateways, message relay — without firmware changes.
- Because the wire format matches native Meshtastic devices exactly (topic
  layout, encryption scheme), the bridge is transparent to the rest of the
  Meshtastic MQTT ecosystem; no special-casing is needed on the receiving
  end.
- Rate-limited, opportunistic re-announcing (on relay traffic, on first GPS
  fix) reduces the window where a remote instance has stale or missing
  information about the gateway node, without flooding the channel outside
  the configured interval.

### Costs and risks

- Re-encryption requires the gateway to hold and use the channel's AES key in
  the daemon process; this is inherent to acting as a bridge and matches how
  a native WiFi-capable device would behave, but it is a meaningful trust
  boundary worth naming explicitly.
- Inbound decryption falls back to searching all attached devices' channels
  by name match, then to the public default PSK — a channel using a custom
  PSK that isn't attached to this daemon under a matching channel name cannot
  be decrypted, and its data is silently dropped (see open question below on
  the related "Multi-device MQTT messages" roadmap item).
- The broad `#`/`{root}/#` subscription, chosen to tolerate inconsistent
  regional topic depths, means the gateway receives and must filter every
  message under the root rather than only the packets it can act on.

## Open questions

- `docs/ROADMAP.md`'s product roadmap lists **"Multi-device MQTT messages —
  use private channel keys to decrypt messages from other devices through
  MQTT"** as an in-progress/exploring item, not yet complete. But
  `_handleInbound`'s current decryption logic already searches across *all*
  currently attached devices' channel keys (matching by channel name) before
  falling back to the default PSK — it is not scoped to a single device.
  Whether that existing behavior already satisfies (or partially satisfies)
  the roadmap item, or whether the roadmap item describes further work not
  yet present in the code (e.g. a way to register additional channel keys
  that aren't tied to a physically attached device, or region-scoped key
  lookup instead of name-only matching), is not resolved by this ADR and
  should be confirmed against the roadmap item's intent directly.

## Follow-up work

None identified by this ADR beyond the open question above.
`docs/ROADMAP.md`'s maintainability track lists "Record architectural
decisions for major choices such as ... MQTT bridging ..." as the item this
ADR satisfies.
