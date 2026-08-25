export interface SetDeviceConfigPayload {
  deviceId: string;
  namespace: "radio" | "module";
  section: string;
  value: Record<string, unknown>;
}

/**
 * Accumulate one field edit into a config card's pending draft. Only explicitly-changed
 * keys are recorded; a later edit to the same key replaces the earlier one.
 */
export function applyDraftEdit(
  draft: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  return { ...draft, [key]: value };
}

/**
 * The value a field editor/display should show: the pending draft edit if the key has
 * one, otherwise the section's current live value.
 */
export function currentFieldValue(
  draft: Record<string, unknown>,
  data: Record<string, unknown>,
  key: string,
): unknown {
  return key in draft ? draft[key] : data[key];
}

/**
 * Build the `device:set-config` payload for a config card's direct-edit save, or `null`
 * if there is nothing to send. An empty draft means the operator made no changes, so
 * saving must exit edit mode without emitting a write. A non-empty draft is sent as-is —
 * `value` contains only the keys the operator actually changed, never the section's full
 * current contents.
 */
export function buildConfigCardSetConfigPayload(
  deviceId: string,
  namespace: "radio" | "module",
  section: string,
  draft: Record<string, unknown>,
): SetDeviceConfigPayload | null {
  if (Object.keys(draft).length === 0) return null;
  return { deviceId, namespace, section, value: draft };
}
