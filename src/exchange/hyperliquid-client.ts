import {
  HttpTransport,
  InfoClient,
  SubscriptionClient,
  WebSocketTransport,
  type ISubscription
} from "@nktkas/hyperliquid";
import type {
  ClearinghouseStateResponse,
  FrontendOpenOrdersResponse,
  MetaAndAssetCtxsResponse,
  OrderStatusResponse,
  SpotClearinghouseStateResponse,
  SpotMetaAndAssetCtxsResponse,
  UserRateLimitResponse
} from "@nktkas/hyperliquid/api/info";
import type { Logger } from "pino";
import type { Address } from "viem";

import type { FoundationMarket } from "../config/markets.js";
import { BootstrapError } from "../core/errors.js";
import type { AppConfig, BootstrapSnapshot, BootMarketSnapshot } from "../core/types.js";

export interface RegistryMetadataSnapshot {
  readonly perpMetaAndAssetCtxs: MetaAndAssetCtxsResponse;
  readonly spotMetaAndAssetCtxs: SpotMetaAndAssetCtxsResponse;
  readonly allMids: Record<string, string>;
}

export interface UserExchangeStateSnapshot {
  readonly clearinghouseState: ClearinghouseStateResponse;
  readonly spotState: SpotClearinghouseStateResponse;
  readonly frontendOpenOrders: FrontendOpenOrdersResponse;
  readonly userRateLimit: UserRateLimitResponse;
}

export class HyperliquidClient {
  readonly infoClient: InfoClient;
  readonly subscriptionClient: SubscriptionClient;
  readonly wsTransport: WebSocketTransport;
  private readonly httpTransport: HttpTransport;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {
    this.httpTransport = new HttpTransport({
      isTestnet: config.network.isTestnet,
      apiUrl: config.network.apiUrl,
      rpcUrl: config.network.rpcUrl,
      timeout: 10_000
    });

    this.wsTransport = new WebSocketTransport({
      isTestnet: config.network.isTestnet,
      url: config.network.wsUrl,
      timeout: 10_000,
      reconnect: {
        maxRetries: 10,
        connectionTimeout: 10_000
      },
      resubscribe: true
    });

    this.infoClient = new InfoClient({ transport: this.httpTransport });
    this.subscriptionClient = new SubscriptionClient({ transport: this.wsTransport });
  }

  async fetchBootstrapSnapshot(): Promise<BootstrapSnapshot> {
    const includeUserState = this.config.bootstrapUserState && this.config.operatorAddress !== undefined;

    const [metadata, userState] = await Promise.all([
      this.fetchRegistryMetadata(),
      includeUserState ? this.fetchUserExchangeState(this.config.operatorAddress) : Promise.resolve(undefined)
    ]);

    const watchedMarkets = selectWatchedMarkets(
      metadata.perpMetaAndAssetCtxs,
      metadata.allMids,
      this.config.watchedMarkets
    );
    const fetchedAt = new Date().toISOString();

    this.logger.info(
      {
        universeSize: metadata.perpMetaAndAssetCtxs[0].universe.length,
        watchedMarkets: watchedMarkets.map((market) => ({
          market: market.market,
          assetId: market.assetId,
          markPrice: market.markPrice
        })),
        accountBootstrapLoaded: userState !== undefined
      },
      "Fetched Hyperliquid bootstrap snapshot"
    );

    return {
      fetchedAt,
      metaAndAssetCtxs: metadata.perpMetaAndAssetCtxs,
      watchedMarkets,
      allMids: metadata.allMids,
      ...(userState !== undefined && this.config.operatorAddress !== undefined
        ? {
            account: {
              operatorAddress: this.config.operatorAddress,
              clearinghouseState: userState.clearinghouseState,
              openOrders: userState.frontendOpenOrders,
              userRateLimit: userState.userRateLimit
            }
          }
        : {})
    };
  }

  async fetchRegistryMetadata(): Promise<RegistryMetadataSnapshot> {
    const [perpMetaAndAssetCtxs, spotMetaAndAssetCtxs, allMids] = await Promise.all([
      this.infoClient.metaAndAssetCtxs(),
      this.infoClient.spotMetaAndAssetCtxs(),
      this.infoClient.allMids()
    ]);

    return {
      perpMetaAndAssetCtxs,
      spotMetaAndAssetCtxs,
      allMids
    };
  }

  async close(): Promise<void> {
    await this.wsTransport.close();
  }

  async unsubscribeAll(subscriptions: readonly ISubscription[]): Promise<void> {
    await Promise.all(
      subscriptions.map(async (subscription) => {
        await subscription.unsubscribe();
      })
    );
  }

  async fetchUserExchangeState(
    operatorAddress: Address | undefined
  ): Promise<UserExchangeStateSnapshot | undefined> {
    if (operatorAddress === undefined) {
      return undefined;
    }

    const [clearinghouseState, spotState, frontendOpenOrders, userRateLimit] = await Promise.all([
      this.infoClient.clearinghouseState({ user: operatorAddress }),
      this.infoClient.spotClearinghouseState({ user: operatorAddress }),
      this.infoClient.frontendOpenOrders({ user: operatorAddress }),
      this.infoClient.userRateLimit({ user: operatorAddress })
    ]);

    return {
      clearinghouseState,
      spotState,
      frontendOpenOrders,
      userRateLimit
    };
  }

  async fetchOrderStatus(
    operatorAddress: Address,
    orderIdentifier: number | `0x${string}`
  ): Promise<OrderStatusResponse> {
    return await this.infoClient.orderStatus({
      user: operatorAddress,
      oid: orderIdentifier
    });
  }
}

function selectWatchedMarkets(
  metaAndAssetCtxs: MetaAndAssetCtxsResponse,
  allMids: Record<string, string>,
  watchedMarkets: readonly FoundationMarket[]
): BootMarketSnapshot[] {
  const [meta, assetCtxs] = metaAndAssetCtxs;

  return watchedMarkets.map((market) => {
    const assetId = meta.universe.findIndex((asset) => asset.name === market);

    if (assetId < 0) {
      throw new BootstrapError(`Watched market ${market} is missing from Hyperliquid perp metadata`);
    }

    const assetContext = assetCtxs[assetId];
    const assetMeta = meta.universe[assetId];

    if (assetContext === undefined || assetMeta === undefined) {
      throw new BootstrapError(`Incomplete asset metadata returned for watched market ${market}`);
    }

    return {
      market,
      assetId,
      sizeDecimals: assetMeta.szDecimals,
      maxLeverage: assetMeta.maxLeverage,
      marginTableId: assetMeta.marginTableId,
      markPrice: assetContext.markPx,
      midPrice: allMids[market] ?? assetContext.midPx,
      oraclePrice: assetContext.oraclePx,
      fundingRate: assetContext.funding,
      openInterest: assetContext.openInterest
    };
  });
}
