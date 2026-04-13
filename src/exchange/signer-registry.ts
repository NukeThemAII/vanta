import type { Logger } from "pino";
import type { PrivateKeyAccount } from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";

import { ConfigurationError } from "../core/errors.js";
import type { AppConfig } from "../core/types.js";
import type { ExecutionIdentity } from "./execution-types.js";

export class SignerRegistry {
  private readonly apiWalletAccount: PrivateKeyAccount | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {
    this.apiWalletAccount =
      this.config.apiWallet !== undefined
        ? privateKeyToAccount(this.config.apiWallet.privateKey)
        : undefined;
  }

  hasExecutionIdentity(): boolean {
    return this.config.operatorAddress !== undefined && this.apiWalletAccount !== undefined;
  }

  getExecutionIdentity(): ExecutionIdentity | undefined {
    if (!this.hasExecutionIdentity() || this.apiWalletAccount === undefined || this.config.operatorAddress === undefined) {
      return undefined;
    }

    return {
      network: this.config.network.name,
      operatorAddress: this.config.operatorAddress,
      signerAddress: this.apiWalletAccount.address,
      signerType: "api_wallet",
      mode: this.config.executionVaultAddress !== undefined ? "vault" : "direct",
      ...(this.config.executionVaultAddress !== undefined
        ? { vaultAddress: this.config.executionVaultAddress }
        : {})
    };
  }

  requireExecutionIdentity(): ExecutionIdentity {
    const identity = this.getExecutionIdentity();

    if (identity === undefined) {
      throw new ConfigurationError(
        "Write-side execution requires both VANTA_OPERATOR_ADDRESS and VANTA_API_WALLET_PRIVATE_KEY"
      );
    }

    return identity;
  }

  getWallet(): PrivateKeyAccount | undefined {
    return this.apiWalletAccount;
  }

  requireWallet(): PrivateKeyAccount {
    if (this.apiWalletAccount === undefined) {
      throw new ConfigurationError("VANTA_API_WALLET_PRIVATE_KEY is required for write-side execution");
    }

    return this.apiWalletAccount;
  }

  logExecutionIdentity(): void {
    const identity = this.getExecutionIdentity();

    if (identity === undefined) {
      this.logger.info(
        {
          operatorConfigured: this.config.operatorAddress !== undefined,
          apiWalletConfigured: this.apiWalletAccount !== undefined
        },
        "Write-side execution identity is not configured"
      );
      return;
    }

    this.logger.info(
      {
        operatorAddress: identity.operatorAddress,
        signerAddress: identity.signerAddress,
        mode: identity.mode,
        vaultAddress: identity.vaultAddress ?? null
      },
      "Resolved write-side execution identity"
    );
  }
}
