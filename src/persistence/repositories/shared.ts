import type { JsonValue } from "../../core/types.js";

export function serializeJson(value: JsonValue | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

export function deserializeJson<T>(value: string | null): T | undefined {
  if (value === null) {
    return undefined;
  }

  return JSON.parse(value) as T;
}
