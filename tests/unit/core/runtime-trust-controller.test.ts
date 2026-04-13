import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { RuntimeStateRepository } from "../../../src/persistence/repositories/runtime-state-repository.js";
import { RuntimeTrustController } from "../../../src/services/runtime-trust-controller.js";
import { createLogger } from "../../../src/core/logger.js";

describe("RuntimeTrustController", () => {
  it("persists runtime trust-state transitions", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE runtime_state_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        boot_id TEXT,
        changed_at TEXT NOT NULL,
        state TEXT NOT NULL,
        reason TEXT NOT NULL,
        details_json TEXT
      )
    `);

    const repository = new RuntimeStateRepository(db);
    const controller = new RuntimeTrustController(
      repository,
      createLogger({
        appEnv: "test",
        logLevel: "silent",
        network: {
          name: "testnet",
          isTestnet: true,
          apiUrl: "",
          wsUrl: "",
          rpcUrl: "",
          rpcWsUrl: "",
          signatureChain: "Testnet",
          hyperEvmChainId: 998
        }
      })
    );

    controller.transition("reconciling", "test:start", { trigger: "manual" }, "boot-1");
    const latest = controller.transition("trusted", "test:complete", { issueCount: 0 }, "boot-1");

    expect(latest.state).toBe("trusted");
    expect(repository.getLatest()?.reason).toBe("test:complete");

    db.close();
  });
});
