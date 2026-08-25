# CONTRACT-012: Device Configuration Transform Behavior

Status: Accepted
Approved by: Patrick
Approved date: 08/24/26
Related tasks: TASK-021 (proposed — split of `DeviceConfigPage.tsx`); builds on
TASK-011 (completed — extracted `setupWizardOutput.ts`) and TASK-016 (in
review — extracted `configMerge.ts`)

## Purpose

`packages/web/src/pages/DeviceConfigPage.tsx` constructs and sends every
`device:set-config` WebSocket command the frontend issues against a
physically connected Meshtastic radio, via two independent transform paths:
the setup wizard (`buildWizardChanges()` + `applyAll()`) and the per-field
direct-edit flow inside `ConfigCard` (`draft` state + `handleSave()`). TASK-021
splits this 1061-line file into a wizard, configuration cards, field editors,
and pure transform modules, and its own task description flags — correctly —
that "a bad transform could misconfigure a physical radio." This contract
exists to record the exact, current, observable behavior of both transform
paths, grounded in the present code (not a redesign), so that TASK-021's
restructuring can be judged against a precise baseline: the ordered set of
`device:set-config` payloads produced for a given set of user inputs must not
change, even though the code that produces them is being relocated.

This is a "pin down what already exists" contract per TASK-021's own framing.
Where an existing test file already characterizes a rule with an executable
assertion, that test is treated as the authoritative specification for that
rule (matching how CONTRACT-001 treated `open.test.ts`), and this contract
supplements it only where the tests are silent.

## Scope

### Included

- `buildWizardChanges()` (`packages/web/src/lib/setupWizardOutput.ts`): its
  exact input→output mapping, insertion order, and collision/merge behavior,
  as already characterized by `setupWizardOutput.test.ts` and supplemented
  here for cases the tests don't cover.
- `mergeConfig()` (`packages/web/src/lib/configMerge.ts`): its exact
  replace-vs-recurse semantics, as already characterized by
  `configMerge.test.ts`.
- `mergedRegionSettings`'s construction inside `SetupWizard`
  (`DeviceConfigPage.tsx:283–290`): the order in which selected regions are
  folded through `mergeConfig()`, and how that determines final
  parent/child precedence for a multi-level region selection.
- The wizard's apply path, `applyAll()` (`DeviceConfigPage.tsx:313–332`): how
  the `ConfigChange[]` array becomes a sequence of `device:set-config` sends,
  their exact payload shape, ordering, and completion/timeout detection.
- `ConfigCard`'s direct field-edit path (`DeviceConfigPage.tsx:927–1076`,
  specifically `draft` state, `handleChange`, and `handleSave`): its payload
  construction, which is independent of the wizard's.
- The wizard-launch precondition guard tying `wizardOpen` to
  `deviceConnected` (`DeviceConfigPage.tsx:117, 131–134, 180–187`).
- The wire shape both paths must produce valid values for:
  `setDeviceConfigSchema` (`packages/shared/src/ws-protocol.ts:137–148`).

### Excluded

- What configuration options/fields exist, or how their values are validated
  before being sent. No client-side value validation exists today anywhere on
  this page (see Failure behavior) — this contract records that absence, it
  does not add any, per TASK-021's own Excluded scope ("Any change to what
  configuration options exist or how they're validated").
- The daemon's handling of `device:set-config`
  (`packages/daemon/src/routes/websocket.ts:446–465` and
  `DeviceManager.applyConfigSection`,
  `packages/daemon/src/device/device-manager.ts:1273–1312`). These are cited
  only as context for the wire boundary this page's output must satisfy — the
  daemon side is not touched by TASK-021 and is not governed by this
  contract.
- Presentational/visual behavior of cards, field inputs, and wizard steps
  (colors, layout, copy). TASK-021's own acceptance criteria treat "no
  visible UI change" as a separate manual-regression concern from payload
  equivalence; this contract governs the latter.
- The content of `region-presets.json` (which regions/settings exist) —
  only the *shape* it must conform to and the merge algorithm operating on it
  are in scope.
- Re-deriving rules that `setupWizardOutput.test.ts` or `configMerge.test.ts`
  already characterize with a passing executable assertion — those tests are
  cited as authoritative rather than restated as new prose requirements.

## Actors

- **Human operator**: drives the wizard or edits a config card field in the
  browser.
- **`SetupWizard`** (`DeviceConfigPage.tsx`): owns wizard step state (role,
  selected regions, mqtt fields, neighborInfo, storeForward) and calls
  `buildWizardChanges()` / `applyAll()`.
- **`ConfigCard`** (`DeviceConfigPage.tsx`): owns per-card `draft` state and
  calls `handleSave()`.
- **`buildWizardChanges()`** (`setupWizardOutput.ts`) and **`mergeConfig()`**
  (`configMerge.ts`): the pure transform functions this contract's
  correctness claims center on.
- **`foremanClient`** (`packages/web/src/ws/client.ts`): the WebSocket
  transport both paths call `.send()`/`.on()` through.
- **Daemon `device:set-config` handler / `DeviceManager`**: the counterparty
  that receives these payloads and writes them to the physical radio (out of
  scope, named for context only).

## Inputs and outputs

### Wizard path

- Inputs: `role: number | null`; `selectedRegions: RegionNode[]` (breadcrumb
  order, root at index 0, leaf at the end); `mqtt: { enabled: boolean;
  address: string; user: string; pass: string }`; `neighborInfo: boolean`;
  `storeForward: boolean`.
- Intermediate: `mergedRegionSettings = selectedRegions.reduce((acc, node) =>
  node.settings ? mergeConfig(acc, node.settings) : acc, {})`
  (`DeviceConfigPage.tsx:283–290`).
- Output of `buildWizardChanges(role, mergedRegionSettings, mqtt,
  neighborInfo, storeForward)`: `ConfigChange[]`, each `{ namespace: "radio"
  | "module"; section: string; value: Record<string, unknown> }`.
- Output of `applyAll()`: one `{ type: "device:set-config", payload: {
  deviceId, namespace, section, value } }` WS command per `ConfigChange`, sent
  in array order.

### Direct field-edit path

- Inputs: the currently-rendered config section's live values (`data`, a
  `Record<string, unknown>` for one `radioConfig`/`moduleConfig` section) and
  a `draft: Record<string, unknown>` accumulating only the keys the operator
  has explicitly changed in the current edit session.
- Output of `handleSave()`: exactly one `{ type: "device:set-config",
  payload: { deviceId, namespace, section, value: draft } }` command —
  `value` contains **only** the edited keys, not the section's full current
  contents.

## Preconditions

- The setup wizard can only be opened when a device is connected: the
  "Launch Wizard →" button is `disabled` unless `deviceConnected`
  (`device?.status === "connected"`, `DeviceConfigPage.tsx:117, 181–187`).
  If the wizard is open and the selected device's connection drops, an effect
  (`DeviceConfigPage.tsx:131–134`) force-closes it (`setWizardOpen(false)`).
- Config cards and field editors only render once a `DeviceConfig` has been
  received for the selected device (`config` is truthy,
  `DeviceConfigPage.tsx:164–168`); before that, the page shows "No config
  received yet for `{port}`."
- `foremanClient.send()` only transmits when the underlying WebSocket's
  `readyState === WebSocket.OPEN`; otherwise it is a silent no-op — no queue,
  no thrown error, no rejected promise (`ws/client.ts:30–34`). Both transform
  paths inherit this precondition without any additional connectivity check
  of their own at send time (the wizard's own guard above only gates
  *opening* the wizard, not the moment `applyAll()`/`handleSave()` actually
  sends).

## Required behavior

### `buildWizardChanges()` — authoritative via existing tests

`packages/web/src/lib/setupWizardOutput.test.ts`'s three cases are the
executable specification and must continue to pass, unmodified, against
wherever `buildWizardChanges` ends up after TASK-021:

- "constructs the complete ordered wizard output" — full role + region +
  mqtt + neighborInfo + storeForward combination, exact ordered array.
- "omits unselected options and blank MQTT credentials" — `mqtt.enabled` with
  all three optional fields blank still emits `module.mqtt` with only the
  three literal boolean defaults, no `address`/`username`/`password` keys.
- "returns no changes when the wizard has no selections" — `[]`.

Rules the tests establish but that are easy to lose sight of during a split,
stated explicitly here:

- **Ordering is Map-insertion order, keyed by `${namespace}.${section}`**
  (`setupWizardOutput.ts:22, 25–33`). A `Map` preserves a key's original
  insertion position even when `.set()` is called again on that same key
  (JS semantics), so the order of the returned array is determined by which
  step *first* touches each `namespace.section` pair, not by which step last
  wrote to it.
- **Insertion attempt order within one call** (`setupWizardOutput.ts:35–60`),
  exactly as coded:
  1. `role !== null` → `radio.device { role }`
  2. Walk `Object.entries(regionSettings)` (namespace), then
     `Object.entries(sections)` (section) of the already-merged region tree,
     adding each `{namespace, section}` whose value is a non-array object.
  3. `mqtt.enabled` → `module.mqtt` with literal `{ enabled: true,
     encryptionEnabled: true, proxyToClientEnabled: true }`, plus
     `address`/`username`/`password` added **only if** the corresponding
     input string is truthy (a blank string, `""`, is falsy in JS and is
     omitted from the payload entirely — it is not sent as `""`, so a blank
     MQTT credential field never overwrites an existing device value with an
     empty string).
  4. `neighborInfo` → `module.neighborInfo { enabled: true, updateInterval:
     900 }`.
  5. `storeForward` → `module.storeForward { enabled: true, isServer: true,
     heartbeat: true }`.
- **Collision merge behavior**: if a later step touches a
  `namespace.section` key an earlier step already added (e.g., the role step
  adds `radio.device`, and a selected region's settings also touch
  `radio.device` — see `region-presets.json`'s `US-CA` node, which sets
  `radio.device.tzdef`), `add()` performs a **shallow merge**:
  `{ ...existing.value, ...values }` — the later step's keys win on a literal
  key collision, but keys unique to either contribution are all preserved
  (`setupWizardOutput.ts:27–32`). No shipped `region-presets.json` data
  currently causes a same-key collision (only same-*section*, different-key
  overlap, e.g. `role` vs `tzdef`), but the code permits it, and this
  shallow-merge-on-collision behavior must not be altered by TASK-021.
- Passing an empty `mergedRegionSettings` (`{}`), `role: null`, and all three
  booleans `false` yields `[]` — no `device:set-config` command is ever sent
  in that state (confirmed by `applyAll()`'s own `if (!changes.length ||
  applying) return;` guard, `DeviceConfigPage.tsx:314`).

### Region merge/precedence (`mergeConfig()` + `mergedRegionSettings`)

`packages/web/src/lib/configMerge.test.ts` is the executable specification
for `mergeConfig()` itself and must continue to pass unmodified:

- Nested-object keys present in both `defaults` and `overrides` are merged
  recursively.
- Arrays, scalars, and `null` in `overrides` **replace** the corresponding
  `defaults` value outright — they are never element-merged.
- Neither input argument is mutated.

Supplementing with the wizard-specific composition rule
(`DeviceConfigPage.tsx:283–290`):

- `selectedRegions` is breadcrumb order, root first
  (`RegionStep.selectRegion`, `DeviceConfigPage.tsx:517–519`, and the
  breadcrumb-click handler at line 540 which truncates to a prefix of this
  same array).
- `mergedRegionSettings` folds `selectedRegions` **left to right** (root →
  leaf) through `mergeConfig(acc, node.settings)`. Because `mergeConfig`'s
  second argument (`overrides`) wins on any real conflict, the **leaf-most
  selected region's settings are applied last and win** — this exactly
  matches `region-presets.json`'s own documented contract: "Settings at each
  level are deep-merged going from root to leaf — child values override
  parent values" (`region-presets.json:3`).
- A region node with no `settings` property contributes nothing to the fold
  (the reduce's `node.settings ? mergeConfig(...) : acc` ternary,
  `DeviceConfigPage.tsx:286`) — selecting a region that only exists for
  navigation (e.g., a purely descriptive intermediate node) is a no-op on
  the merged tree.
- A given namespace/section key's position in `mergedRegionSettings`'s
  object-key order is fixed at whichever selected region first introduces
  that key; a later region overriding that key's *value* does not move its
  position. Since `buildWizardChanges` step 2 walks
  `Object.entries(mergedRegionSettings)` in this order, this transitively
  determines the order of region-derived entries in the final
  `ConfigChange[]` array.

### Wizard apply (`applyAll`, `DeviceConfigPage.tsx:313–332`)

- No-op guard: does nothing if `changes.length === 0` or an apply is already
  `applying`.
- Sends exactly one `device:set-config` command per entry of `changes`, in
  `changes` array order, inside a plain synchronous `for` loop — all N sends
  happen in the same tick, not awaited or rate-limited individually. Each
  payload is `{ deviceId, namespace: ch.namespace, section: ch.section,
  value: ch.value }`.
- Completion detection is **not** correlated to the specific sends it made:
  it resolves `applied = true` on the **first** `device:config` event
  received from the WS client after the sends (no filtering by `deviceId` or
  by which section changed, `DeviceConfigPage.tsx:324–331`), or after a fixed
  **12-second** timeout, whichever comes first. It has no handler for a
  `type: "error"` event of any kind — a `SET_CONFIG_FAILED` response from the
  daemon is silently ignored by the wizard, which will still declare success
  once its timeout elapses.

### Direct field-edit (`ConfigCard`, `DeviceConfigPage.tsx:927–1076`)

- `draft` accumulates only explicitly-changed keys via `handleChange` (lines
  957–959: `setDraft((p) => ({ ...p, [key]: val }))`); `currentVal(key)`
  reads `draft[key]` if present, else falls back to the live `data[key]`
  (954–956) — the UI always shows either a pending edit or the current
  server value, never a stale merge of both.
- `handleSave()`: if `draft` is empty, exits edit mode with **no** WS send
  (961–965: `if (Object.keys(draft).length === 0) { setEditMode(false);
  return; }`). Otherwise sends exactly **one** `device:set-config` command,
  `{ deviceId, namespace, section, value: draft }` — `value` contains only
  the keys the operator actually changed, not the section's full current
  contents.
- Completion detection mirrors the wizard's event-driven pattern but is
  per-card and additionally handles explicit failure: a **10-second**
  timeout → `saveStatus = "error"` (auto-clears after 4s); OR a
  `device:config` event (same unfiltered-by-deviceId/section caveat as the
  wizard) → `saveStatus = "ok"`, clears `draft`, exits edit mode
  (auto-clears the "ok" indicator after 2.5s); OR an explicit `{ type:
  "error", payload: { code: "SET_CONFIG_FAILED" } }` event → immediate
  `saveStatus = "error"` (987–993). This `SET_CONFIG_FAILED` handling is the
  **only** place on this page that reacts to an explicit device-side
  rejection.
- Editability is restricted client-side by `canEdit()` (1078–1082):
  `SENSITIVE_KEYS` (`privateKey`, `publicKey`, `adminKey`, `password`,
  `psk`, `fixedPin`) and any array/object-typed value are never rendered
  with an inline editor — only boolean/number/string leaf scalars are
  editable. This is scope-limiting (what's editable), not value validation
  (what's an acceptable edited value).
- This path shares **no code** with `buildWizardChanges()` or
  `mergeConfig()` — `ConfigCard` never calls either function, and neither
  function is aware of `ConfigCard`. The two payload-construction paths are
  fully independent today.

## Postconditions and invariants

- **Central invariant** (matches TASK-021's own acceptance criterion): for a
  fixed set of user inputs — a wizard configuration (role, region
  breadcrumb, mqtt fields/toggle, neighborInfo, storeForward), or a given
  field-editor `draft` for a given section — the ordered sequence of
  `device:set-config` payloads (`namespace`, `section`, `value`, and their
  relative send order) constructed and sent must be identical before and
  after TASK-021's restructuring. Moving `buildWizardChanges`, `mergeConfig`,
  the wizard steps, config cards, or field editors into new files/components
  must not change which functions are called, with what arguments, in what
  order, or what they return.
- The literal constants embedded in `buildWizardChanges` — `updateInterval:
  900` for neighborInfo; `enabled`/`encryptionEnabled`/`proxyToClientEnabled`
  all `true` for mqtt; `enabled`/`isServer`/`heartbeat` all `true` for
  storeForward — are frozen values already covered by
  `setupWizardOutput.test.ts` and must not become configurable, inferred, or
  "cleaned up" as a byproduct of the split.
- The Map-based collision/merge semantics inside `buildWizardChanges`, and
  `mergeConfig`'s replace-vs-recurse rule, must be preserved exactly — these
  functions may be relocated (or left where TASK-011/TASK-016 already put
  them) but their internals must not change as a side effect of
  restructuring the surrounding page.
- The wizard path and the direct field-edit path must remain independent
  after extraction. TASK-021 may co-locate them in a shared module directory,
  but must not merge them into one shared function/code path unless the
  human explicitly approves that as new design — this contract only pins
  down what exists today, which is two separate paths.
- The wizard-launch connectivity guard (disabled button while disconnected;
  auto-close effect on disconnect while open) must be preserved verbatim —
  the task brief that commissioned this contract specifically identifies
  this as a deliberate fix already applied to the current file, not an
  accident of its current organization.

## Failure behavior

- **No client-side value validation exists anywhere on this page today**,
  for either transform path. `canEdit()`'s type/sensitivity gate controls
  what is *editable*, not what values are *acceptable* — whatever the
  operator types into a number/text input, or toggles on a boolean, is sent
  exactly as entered. This absence must be preserved as-is; TASK-021's own
  scope explicitly excludes adding validation.
- **Transport-level silent drop**: `foremanClient.send()` does nothing
  (no exception, no rejected promise, no visible error) if the WebSocket
  isn't `OPEN` (`ws/client.ts:30–34`). Clicking "Apply to device" or "Save"
  while disconnected still runs the full 12s/10s timeout → "error"/failure
  UI, but the failure UI cannot distinguish "nothing was ever sent" from
  "the daemon received it and rejected it."
- **Asymmetric daemon-rejection handling between the two paths**:
  `ConfigCard` explicitly listens for `SET_CONFIG_FAILED` and surfaces it
  immediately; the wizard's `applyAll()` has no such handler and will run
  out its full 12-second timeout and still set `applied = true` regardless
  of whether the daemon actually accepted every write. This is existing,
  asymmetric behavior — flagged for the human's attention in Open Questions,
  not something this contract invents or silently resolves.
- **Unscoped completion-event correlation**: both `applyAll()` and
  `ConfigCard.handleSave()` treat the first `device:config` event received
  from the WS client (regardless of which device or config section it
  actually describes) as confirmation of their own write. In a single-device
  session this is unobservable; with multiple connected devices open
  simultaneously, it is a latent cross-device false-positive. Preserved
  as-is.

## Interfaces

```ts
// packages/web/src/lib/setupWizardOutput.ts
export interface ConfigChange {
  namespace: "radio" | "module";
  section: string;
  value: Record<string, unknown>;
}
export interface WizardMqttInput {
  enabled: boolean;
  address: string;
  user: string;
  pass: string;
}
export function buildWizardChanges(
  role: number | null,
  regionSettings: Record<string, unknown>,
  mqtt: WizardMqttInput,
  neighborInfo: boolean,
  storeForward: boolean,
): ConfigChange[];

// packages/web/src/lib/configMerge.ts
export function mergeConfig(
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown>;

// packages/shared/src/ws-protocol.ts — the wire contract both paths target
export const setDeviceConfigSchema = z.object({
  type: z.literal("device:set-config"),
  payload: z.object({
    deviceId: z.string().uuid(),
    namespace: z.enum(["radio", "module"]),
    section: z.string().min(1),
    value: z.record(z.unknown()),
  }),
});

// packages/shared/src/types.ts — the read side both paths render from
export interface DeviceConfig {
  deviceId: string;
  radioConfig: Record<string, unknown>; // keyed by section name, e.g. "lora"
  moduleConfig: Record<string, unknown>; // keyed by section name, e.g. "mqtt"
  channels: Channel[];
}
```

## UX expectations

Primarily out of scope (see Excluded), but the following observable states
interact with the transforms above and must survive extraction per TASK-021's
own "no visible change" acceptance criterion: the wizard's "Launch Wizard →"
button disabled/tooltip state while disconnected; the wizard's
applying/applied states in the Review step; `ConfigCard`'s
saving/"Saved ✓"/"Save failed — check device connection" states and their
2.5s/4s auto-clear timers; the wizard's auto-close behavior if the device
disconnects while the wizard is open.

## Validation requirements

- `packages/web/src/lib/setupWizardOutput.test.ts` must continue to pass,
  unmodified, against `buildWizardChanges` wherever it ends up after TASK-021
  — this is TASK-021's own plan step 1 ("confirm TASK-011's extraction is in
  place").
- `packages/web/src/lib/configMerge.test.ts` must continue to pass,
  unmodified, against `mergeConfig` wherever it ends up.
- Per TASK-021's own validation requirements, a before/after comparison of
  the actual `device:set-config` payload arrays constructed for a fixed
  matrix of wizard inputs is recommended, specifically including: (a) a
  region-merge collision case selecting a multi-level breadcrumb (e.g. the
  shipped `US → US-CA → US-CA-Humboldt` chain, which exercises
  parent/child `radio`/`module` key introduction order and override), and
  (b) a role+region same-section collision case (a role selection combined
  with a region whose settings also touch `radio.device`, exercising the
  shallow-merge-on-collision rule above).
- No test file exists today for `ConfigCard`'s direct-edit payload
  construction. Adding one as part of TASK-021's extraction (now that this
  logic is moving into its own module) is recommended but not mandated by
  this contract — flagged for the human to decide whether to fold into
  TASK-021's scope or track separately.
- Manual regression: full wizard flow (role → region → features → review →
  apply) against a connected device or simulator, and direct field edits on
  at least one boolean, one number, and one string field, confirming both
  payload and UI parity.

## Open questions

1. **Byte-for-byte comparison granularity.** TASK-021's acceptance criteria
   call for comparing "the constructed `setDeviceConfigSchema` payload
   before/after." This contract's Postconditions treat the *outer*
   `ConfigChange[]`/send order as strictly order-sensitive (per the Map
   insertion-order rule above), but does not mandate that a `value` object's
   own internal key order be treated as observable (a deep-equality/`toEqual`
   check, as `setupWizardOutput.test.ts` already uses, is order-insensitive
   for object keys). The human should confirm that TASK-021's comparison
   should use deep-equality (matching the existing test style) rather than a
   strict serialized-string comparison, since the latter would make
   incidental JS object-key-order differences look like regressions.
   **Resolved 2026-08-24: deep equality, matching existing test style —
   outer `ConfigChange[]`/send order stays strictly significant, `value`
   object key order does not.**
2. **The wizard's missing `SET_CONFIG_FAILED` handling.** `ConfigCard`
   explicitly surfaces a daemon-side rejection; the wizard does not and will
   report `applied = true` after its timeout regardless of a rejection. This
   contract preserves that asymmetry as existing behavior (TASK-021 is
   behavior-preserving only), but it is a real, pre-existing UX/reliability
   gap on the higher-consequence path (bulk wizard writes vs. single-field
   edits). **Resolved 2026-08-24: Patrick confirmed a small follow-up is
   warranted — see TASK-040, sequenced after TASK-021 lands so it targets
   the wizard's now-extracted apply module rather than the current
   monolithic file.**
3. **Unscoped completion-event correlation** (see Failure behavior) is a
   second pre-existing multi-device correctness gap, independent of #2.
   **Resolved 2026-08-24: Patrick confirmed this also warrants a follow-up —
   see TASK-041, likewise sequenced after TASK-021.**
4. **Should `ConfigCard`'s direct-edit transform gain its own test file as
   part of TASK-021**, given none exists today and the logic is being
   extracted into a standalone module regardless? **Resolved 2026-08-24:
   Patrick confirmed yes — folded directly into TASK-021's scope and
   acceptance criteria rather than tracked as a separate task.**

## Follow-up work

- **TASK-040** (proposed): add explicit `SET_CONFIG_FAILED` handling to the
  wizard's `applyAll()`, matching `ConfigCard`'s existing pattern. Depends on
  TASK-021 landing (targets the extracted wizard-apply module).
- **TASK-041** (proposed): correlate `device:set-config` completion events to
  the specific device/write instead of treating the first `device:config`
  event from any device as confirmation. Depends on TASK-021 landing (targets
  the extracted apply modules for both the wizard and `ConfigCard`).
