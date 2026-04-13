import { createHash, randomUUID } from "node:crypto";

import type { Hex } from "viem";

import { ExecutionError } from "../core/errors.js";
import type { JsonValue } from "../core/types.js";

export interface CloidGenerationResult {
  readonly correlationId: string;
  readonly clientOrderId: Hex;
}

export class CloidService {
  generate(input?: {
    readonly correlationId?: string;
    readonly context?: JsonValue;
  }): CloidGenerationResult {
    const correlationId = input?.correlationId ?? randomUUID();
    const context = input?.context ?? correlationId;

    return {
      correlationId,
      clientOrderId: this.createDeterministic(context)
    };
  }

  createDeterministic(context: JsonValue): Hex {
    const serialized = stableSerialize(context);
    const digest = createHash("sha256").update(serialized).digest("hex").slice(0, 32);
    return `0x${digest}` as Hex;
  }

  normalize(value: string): Hex {
    if (!/^0x[a-fA-F0-9]{32}$/.test(value)) {
      throw new ExecutionError("Client order id must be a 16-byte 0x-prefixed hex string");
    }

    return value.toLowerCase() as Hex;
  }
}

function stableSerialize(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`);

  return `{${entries.join(",")}}`;
}
