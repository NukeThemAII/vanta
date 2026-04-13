import { afterEach, describe, expect, it } from "vitest";

import { installRuntimePolyfills } from "../../../src/core/runtime.js";

const originalCloseEvent = globalThis.CloseEvent;

afterEach(() => {
  if (originalCloseEvent === undefined) {
    delete (globalThis as { CloseEvent?: typeof CloseEvent }).CloseEvent;
    return;
  }

  globalThis.CloseEvent = originalCloseEvent;
});

describe("installRuntimePolyfills", () => {
  it("installs a CloseEvent polyfill when the runtime does not provide one", () => {
    delete (globalThis as { CloseEvent?: typeof CloseEvent }).CloseEvent;

    installRuntimePolyfills();

    expect(typeof globalThis.CloseEvent).toBe("function");

    const event = new CloseEvent("close", {
      code: 1000,
      reason: "normal",
      wasClean: true
    });

    expect(event.code).toBe(1000);
    expect(event.reason).toBe("normal");
    expect(event.wasClean).toBe(true);
  });
});
