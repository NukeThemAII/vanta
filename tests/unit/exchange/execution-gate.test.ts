import pino from "pino";
import { describe, expect, it } from "vitest";

import { DEFAULT_RISK_CONFIG } from "../../../src/config/risk.js";
import { resolveNetworkConfig } from "../../../src/config/networks.js";
import type { AppConfig } from "../../../src/core/types.js";
import { ExecutionGateError } from "../../../src/core/errors.js";
import { ExecutionGate } from "../../../src/exchange/execution-gate.js";
import { SignerRegistry } from "../../../src/exchange/signer-registry.js";
import { SqliteDatabase } from "../../../src/persistence/db.js";
import { RuntimeStateRepository } from "../../../src/persistence/repositories/runtime-state-repository.js";
import { RuntimeTrustController } from "../../../src/services/runtime-trust-controller.js";

describe("ExecutionGate", () => {
  it("allows write access only when runtime trust is trusted on testnet", () => {
    const db = new SqliteDatabase(":memory:");
    const controller = new RuntimeTrustController(
      new RuntimeStateRepository(db.connection),
      pino({ level: "silent" })
    );
    const gate = new ExecutionGate(
      controller,
      new SignerRegistry(makeConfig("testnet"), pino({ level: "silent" }))
    );

    controller.transition("trusted", "test:trusted");

    const identity = gate.requireWriteAccess("place_order");
    expect(identity.network).toBe("testnet");
    expect(identity.operatorAddress).toBe("0x1111111111111111111111111111111111111111");

    db.close();
  });

  it("blocks writes when trust is degraded or when the network is mainnet", () => {
    const degradedDb = new SqliteDatabase(":memory:");
    const degradedController = new RuntimeTrustController(
      new RuntimeStateRepository(degradedDb.connection),
      pino({ level: "silent" })
    );
    const degradedGate = new ExecutionGate(
      degradedController,
      new SignerRegistry(makeConfig("testnet"), pino({ level: "silent" }))
    );

    degradedController.transition("degraded", "test:degraded");
    expect(() => degradedGate.requireWriteAccess("place_order")).toThrow(ExecutionGateError);
    degradedDb.close();

    const mainnetDb = new SqliteDatabase(":memory:");
    const mainnetController = new RuntimeTrustController(
      new RuntimeStateRepository(mainnetDb.connection),
      pino({ level: "silent" })
    );
    const mainnetGate = new ExecutionGate(
      mainnetController,
      new SignerRegistry(makeConfig("mainnet"), pino({ level: "silent" }))
    );

    mainnetController.transition("trusted", "test:trusted");
    expect(() => mainnetGate.requireWriteAccess("place_order")).toThrow("restricted to testnet");
    mainnetDb.close();
  });
});

function makeConfig(networkName: "testnet" | "mainnet"): AppConfig {
  return {
    appEnv: "test",
    network: resolveNetworkConfig(networkName),
    logLevel: "silent",
    sqlitePath: ":memory:",
    risk: DEFAULT_RISK_CONFIG,
    watchedMarkets: ["BTC", "ETH"],
    operatorAddress: "0x1111111111111111111111111111111111111111",
    apiWallet: {
      privateKey: `0x${"11".repeat(32)}`
    },
    bootstrapUserState: true
  };
}
