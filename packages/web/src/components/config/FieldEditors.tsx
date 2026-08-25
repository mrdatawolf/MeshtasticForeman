import { SENSITIVE_KEYS } from "./configConstants.js";
import { styles, toggleBtnClass } from "./configStyles.js";
import localStyles from "./FieldEditors.module.css";

/** Whether a config field may be shown with an inline editor (scope-limiting, not value validation). */
export function canEdit(key: string, val: unknown): boolean {
  if (SENSITIVE_KEYS.has(key)) return false;
  if (Array.isArray(val) || (val !== null && typeof val === "object")) return false;
  return true;
}

/** Inline editor for a boolean/number/string leaf field. */
export function FieldEditor({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  if (typeof value === "boolean") {
    return (
      <button className={toggleBtnClass(value)} onClick={() => onChange(fieldKey, !value)}>
        {value ? "ON" : "OFF"}
      </button>
    );
  }
  if (typeof value === "number") {
    return (
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(fieldKey, Number(e.target.value))}
        className={styles.inputNum}
      />
    );
  }
  return (
    <input
      type="text"
      value={String(value ?? "")}
      onChange={(e) => onChange(fieldKey, e.target.value)}
      className={styles.inputText}
    />
  );
}

/** Read-only rendering of a field value, honoring sensitivity masking and enum lookups. */
export function FieldDisplay({
  value,
  sensitive,
  lookup,
}: {
  value: unknown;
  sensitive: boolean;
  lookup?: Record<number, string>;
}) {
  if (sensitive) return <span className={localStyles.sensitiveMask}>••••••••</span>;
  if (value === null || value === undefined) return <span className={localStyles.emptyDim}>—</span>;
  if (typeof value === "boolean")
    return (
      <span className={value ? localStyles.boolTrue : localStyles.boolFalse}>
        {value ? "true" : "false"}
      </span>
    );
  if (typeof value === "number") {
    if (lookup?.[value]) {
      return (
        <span>
          <span className={localStyles.plainValue}>{lookup[value]}</span>
          <span className={localStyles.enumCode}>({value})</span>
        </span>
      );
    }
    return <span className={localStyles.plainValue}>{value}</span>;
  }
  if (typeof value === "string")
    return value === "" ? (
      <span className={localStyles.emptyDim}>{`""`}</span>
    ) : (
      <span className={localStyles.plainValue}>{value}</span>
    );
  if (Array.isArray(value))
    return (
      <span className={localStyles.arrayValue}>
        {value.length === 0 ? "[]" : JSON.stringify(value)}
      </span>
    );
  return <span className={localStyles.rawValue}>{JSON.stringify(value)}</span>;
}
