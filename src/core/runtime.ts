class NodeCloseEvent extends Event implements CloseEvent {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;

  constructor(type: string, eventInitDict: CloseEventInit = {}) {
    super(type, eventInitDict);
    this.code = eventInitDict.code ?? 0;
    this.reason = eventInitDict.reason ?? "";
    this.wasClean = eventInitDict.wasClean ?? false;
  }
}

export function installRuntimePolyfills(): void {
  if (typeof globalThis.CloseEvent === "undefined") {
    Object.defineProperty(globalThis, "CloseEvent", {
      configurable: true,
      writable: true,
      value: NodeCloseEvent
    });
  }
}
