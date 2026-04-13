import {
  ExchangeClient,
  HttpTransport,
  type ExchangeClient as ExchangeClientType
} from "@nktkas/hyperliquid";
import type {
  CancelByCloidParameters,
  CancelByCloidSuccessResponse,
  CancelParameters,
  CancelSuccessResponse,
  ModifyParameters,
  ModifySuccessResponse,
  OrderParameters,
  OrderSuccessResponse,
  ScheduleCancelParameters,
  ScheduleCancelSuccessResponse,
  UpdateLeverageParameters,
  UpdateLeverageSuccessResponse
} from "@nktkas/hyperliquid/api/exchange";
import type { Logger } from "pino";

import { ConfigurationError } from "../core/errors.js";
import type { AppConfig } from "../core/types.js";
import type { ExecutionNonceController } from "./nonce-manager.js";
import type { SignerRegistry } from "./signer-registry.js";

export class ExecutionExchangeClient {
  private readonly client: ExchangeClientType | undefined;

  constructor(
    config: AppConfig,
    signerRegistry: SignerRegistry,
    nonceController: ExecutionNonceController,
    private readonly logger: Logger
  ) {
    const wallet = signerRegistry.getWallet();
    const identity = signerRegistry.getExecutionIdentity();

    if (wallet === undefined || identity === undefined) {
      this.client = undefined;
      return;
    }

    const transport = new HttpTransport({
      isTestnet: config.network.isTestnet,
      apiUrl: config.network.apiUrl,
      rpcUrl: config.network.rpcUrl,
      timeout: 10_000
    });

    this.client = new ExchangeClient({
      transport,
      wallet,
      signatureChainId: config.network.signatureChainId,
      ...(config.executionVaultAddress !== undefined
        ? { defaultVaultAddress: config.executionVaultAddress }
        : {}),
      nonceManager: nonceController.createSdkNonceManager()
    });

    this.logger.info(
      {
        signerAddress: identity.signerAddress,
        operatorAddress: identity.operatorAddress,
        vaultAddress: identity.vaultAddress ?? null
      },
      "Configured Hyperliquid write-side client"
    );
  }

  isConfigured(): boolean {
    return this.client !== undefined;
  }

  async placeOrder(params: OrderParameters): Promise<OrderSuccessResponse> {
    return await this.requireClient().order(params);
  }

  async cancelOrder(params: CancelParameters): Promise<CancelSuccessResponse> {
    return await this.requireClient().cancel(params);
  }

  async cancelOrderByCloid(params: CancelByCloidParameters): Promise<CancelByCloidSuccessResponse> {
    return await this.requireClient().cancelByCloid(params);
  }

  async modifyOrder(params: ModifyParameters): Promise<ModifySuccessResponse> {
    return await this.requireClient().modify(params);
  }

  async updateLeverage(params: UpdateLeverageParameters): Promise<UpdateLeverageSuccessResponse> {
    return await this.requireClient().updateLeverage(params);
  }

  async scheduleCancel(params?: ScheduleCancelParameters): Promise<ScheduleCancelSuccessResponse> {
    return params === undefined
      ? await this.requireClient().scheduleCancel()
      : await this.requireClient().scheduleCancel(params);
  }

  private requireClient(): ExchangeClientType {
    if (this.client === undefined) {
      throw new ConfigurationError("Write-side exchange client is not configured");
    }

    return this.client;
  }
}
