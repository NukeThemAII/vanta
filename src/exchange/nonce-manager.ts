import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Single-process nonce controller for one write signer per Vanta process.
 *
 * The Hyperliquid SDK already serializes exchange submissions per signer address.
 * Vanta adds this explicit nonce controller so we can:
 * - keep nonce issuance isolated in one module
 * - record the exact nonce used by each outbound action
 * - make the single-writer assumption obvious in code
 */
export class ExecutionNonceController {
  private readonly actionContext = new AsyncLocalStorage<{ readonly actionId: string }>();
  private readonly latestNonceBySigner = new Map<string, number>();
  private readonly nonceByAction = new Map<string, number>();
  private readonly waitersByAction = new Map<string, Array<(nonce: number) => void>>();

  async runWithAction<T>(actionId: string, operation: () => Promise<T>): Promise<T> {
    return await this.actionContext.run({ actionId }, operation);
  }

  createSdkNonceManager(): (address: string) => number {
    return (address) => this.issueNonce(address);
  }

  getActionNonce(actionId: string): number | undefined {
    return this.nonceByAction.get(actionId);
  }

  async waitForActionNonce(actionId: string): Promise<number> {
    const existing = this.nonceByAction.get(actionId);
    if (existing !== undefined) {
      return existing;
    }

    return await new Promise<number>((resolve) => {
      const waiters = this.waitersByAction.get(actionId) ?? [];
      waiters.push(resolve);
      this.waitersByAction.set(actionId, waiters);
    });
  }

  private issueNonce(address: string): number {
    const signerKey = address.toLowerCase();
    const now = Date.now();
    const latest = this.latestNonceBySigner.get(signerKey) ?? 0;
    const nonce = now > latest ? now : latest + 1;

    this.latestNonceBySigner.set(signerKey, nonce);

    const actionId = this.actionContext.getStore()?.actionId;
    if (actionId !== undefined) {
      this.nonceByAction.set(actionId, nonce);
      const waiters = this.waitersByAction.get(actionId);
      if (waiters !== undefined) {
        this.waitersByAction.delete(actionId);
        for (const waiter of waiters) {
          waiter(nonce);
        }
      }
    }

    return nonce;
  }
}
