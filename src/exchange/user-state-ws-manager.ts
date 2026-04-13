import type { ISubscription, SubscriptionClient } from "@nktkas/hyperliquid";
import type {
  ClearinghouseStateEvent,
  OpenOrdersEvent,
  OrderUpdatesEvent,
  SpotStateEvent,
  UserEventsEvent,
  UserFillsEvent
} from "@nktkas/hyperliquid/api/subscription";
import type { Logger } from "pino";
import type { Address } from "viem";

import type { AppEventRecordInput, AppEventSeverity, JsonValue } from "../core/types.js";
import type { AssetRegistry } from "./asset-registry.js";
import type { OrderStateMachine } from "./order-state-machine.js";
import type { AccountStateMirror } from "../portfolio/account-mirror.js";
import type { OpenOrderMirror } from "./open-order-mirror.js";
import type { AppEventRepository } from "../persistence/repositories/app-event-repository.js";
import type { UserEventRepository } from "../persistence/repositories/user-event-repository.js";
import {
  normalizeClearinghouseStateEvent,
  normalizeOpenOrdersEvent,
  normalizeOrderUpdatesEvent,
  normalizeSpotStateEvent,
  normalizeUserEventsEvent,
  normalizeUserFillsEvent
} from "./user-event-normalizers.js";

interface UserStateWsManagerOptions {
  readonly bootId: string;
  readonly network: "testnet" | "mainnet";
  readonly operatorAddress: Address;
  readonly subscriptionClient: SubscriptionClient;
  readonly logger: Logger;
  readonly appEvents: AppEventRepository;
  readonly userEventRepository: UserEventRepository;
  readonly accountMirror: AccountStateMirror;
  readonly openOrderMirror: OpenOrderMirror;
  readonly orderStateMachine: OrderStateMachine;
  readonly getRegistry: () => AssetRegistry | undefined;
  readonly onFatalFailure: (error: Error) => void;
}

export class UserStateWsManager {
  private readonly subscriptions: ISubscription[] = [];
  private readonly eventCounts = new Map<string, number>();
  private started = false;

  constructor(private readonly options: UserStateWsManagerOptions) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    const clearinghouseSubscription = await this.options.subscriptionClient.clearinghouseState(
      { user: this.options.operatorAddress },
      (event) => {
        this.handleClearinghouseState(event);
      }
    );
    this.registerSubscription("clearinghouseState", clearinghouseSubscription);

    const spotStateSubscription = await this.options.subscriptionClient.spotState(
      { user: this.options.operatorAddress },
      (event) => {
        this.handleSpotState(event);
      }
    );
    this.registerSubscription("spotState", spotStateSubscription);

    const openOrdersSubscription = await this.options.subscriptionClient.openOrders(
      { user: this.options.operatorAddress },
      (event) => {
        this.handleOpenOrders(event);
      }
    );
    this.registerSubscription("openOrders", openOrdersSubscription);

    const orderUpdatesSubscription = await this.options.subscriptionClient.orderUpdates(
      { user: this.options.operatorAddress },
      (event) => {
        this.handleOrderUpdates(event);
      }
    );
    this.registerSubscription("orderUpdates", orderUpdatesSubscription);

    const userFillsSubscription = await this.options.subscriptionClient.userFills(
      { user: this.options.operatorAddress, aggregateByTime: true },
      (event) => {
        this.handleUserFills(event);
      }
    );
    this.registerSubscription("userFills", userFillsSubscription);

    const userEventsSubscription = await this.options.subscriptionClient.userEvents(
      { user: this.options.operatorAddress },
      (event) => {
        this.handleUserEvents(event);
      }
    );
    this.registerSubscription("userEvents", userEventsSubscription);

    this.recordAppEvent("user_state.subscribed", "info", "Registered user-state subscriptions", {
      operatorAddress: this.options.operatorAddress,
      subscriptions: [
        "clearinghouseState",
        "spotState",
        "openOrders",
        "orderUpdates",
        "userFills",
        "userEvents"
      ]
    });

    this.started = true;
  }

  async stop(): Promise<void> {
    for (const subscription of this.subscriptions.splice(0).reverse()) {
      await subscription.unsubscribe();
    }

    this.started = false;
  }

  getStats(): Record<string, number> {
    return Object.fromEntries(this.eventCounts);
  }

  private handleClearinghouseState(event: ClearinghouseStateEvent): void {
    const registry = this.requireRegistry();
    const normalizedRecord = normalizeClearinghouseStateEvent(this.options.operatorAddress, event);
    this.options.userEventRepository.insert(normalizedRecord, this.options.bootId);
    this.options.accountMirror.applyPerpState({
      syncedAt: normalizedRecord.receivedAt,
      registry,
      clearinghouseState: event.clearinghouseState
    });
    this.increment("clearinghouseState");
    this.logEvent("clearinghouseState", {
      time: event.clearinghouseState.time,
      positionCount: event.clearinghouseState.assetPositions.length
    });
  }

  private handleSpotState(event: SpotStateEvent): void {
    const normalizedRecord = normalizeSpotStateEvent(this.options.operatorAddress, event);
    this.options.userEventRepository.insert(normalizedRecord, this.options.bootId);
    this.options.accountMirror.applySpotState({
      syncedAt: normalizedRecord.receivedAt,
      spotState: event.spotState
    });
    this.increment("spotState");
    this.logEvent("spotState", {
      balanceCount: event.spotState.balances.length
    });
  }

  private handleOpenOrders(event: OpenOrdersEvent): void {
    const registry = this.requireRegistry();
    const normalizedRecord = normalizeOpenOrdersEvent(this.options.operatorAddress, event);
    this.options.userEventRepository.insert(normalizedRecord, this.options.bootId);
    const syncedAt = normalizedRecord.receivedAt;
    this.options.openOrderMirror.applyOpenOrdersSnapshot({
      syncedAt: normalizedRecord.receivedAt,
      registry,
      openOrdersEvent: event
    });
    this.options.orderStateMachine.applyOpenOrderSnapshot({
      operatorAddress: this.options.operatorAddress,
      network: this.options.network,
      source: "websocket_stream",
      syncedAt,
      orders: this.options.openOrderMirror.getSnapshot()?.orders ?? []
    });
    this.increment("openOrders");
    this.logEvent("openOrders", {
      orderCount: event.orders.length
    });
  }

  private handleOrderUpdates(event: OrderUpdatesEvent): void {
    const registry = this.requireRegistry();
    const normalizedRecords = normalizeOrderUpdatesEvent(this.options.operatorAddress, event);
    const syncedAt = normalizedRecords[0]?.receivedAt ?? new Date().toISOString();
    this.options.userEventRepository.insertMany(normalizedRecords, this.options.bootId);
    this.options.openOrderMirror.applyOrderUpdates({
      orderUpdates: event,
      registry,
      syncedAt
    });
    this.options.orderStateMachine.applyOrderUpdates({
      operatorAddress: this.options.operatorAddress,
      registry,
      updates: event,
      occurredAt: syncedAt
    });
    this.increment("orderUpdates", event.length);
    this.logEvent("orderUpdates", {
      updateCount: event.length,
      latestStatus: event.at(-1)?.status ?? null
    });
  }

  private handleUserFills(event: UserFillsEvent): void {
    const registry = this.requireRegistry();
    const normalizedRecords = normalizeUserFillsEvent(this.options.operatorAddress, event);
    const occurredAt = normalizedRecords[0]?.receivedAt ?? new Date().toISOString();
    this.options.userEventRepository.insertMany(normalizedRecords, this.options.bootId);
    this.options.orderStateMachine.applyUserFills({
      operatorAddress: this.options.operatorAddress,
      registry,
      fills: event,
      occurredAt
    });
    this.increment("userFills", event.fills.length);
    this.logEvent("userFills", {
      fillCount: event.fills.length,
      isSnapshot: event.isSnapshot === true,
      lastFillTime: event.fills.at(-1)?.time ?? null
    });
  }

  private handleUserEvents(event: UserEventsEvent): void {
    const normalizedRecord = normalizeUserEventsEvent(this.options.operatorAddress, event);
    this.options.userEventRepository.insert(normalizedRecord, this.options.bootId);
    this.increment("userEvents");
    this.logEvent("userEvents", normalizedRecord.payload);
  }

  private requireRegistry(): AssetRegistry {
    const registry = this.options.getRegistry();

    if (registry === undefined) {
      const error = new Error("Asset registry is unavailable for user-state processing");
      this.options.onFatalFailure(error);
      throw error;
    }

    return registry;
  }

  private registerSubscription(label: string, subscription: ISubscription): void {
    subscription.failureSignal.addEventListener(
      "abort",
      () => {
        const reason = subscription.failureSignal.reason;
        const error = reason instanceof Error ? reason : new Error(`Subscription ${label} could not be restored`);

        this.recordAppEvent("user_state.subscription_failure", "error", `User-state subscription failure: ${label}`, {
          label,
          message: error.message
        });

        this.options.logger.error({ err: error, subscription: label }, "User-state subscription failed");
        this.options.onFatalFailure(error);
      },
      { once: true }
    );

    this.subscriptions.push(subscription);
  }

  private increment(key: string, count = 1): void {
    this.eventCounts.set(key, (this.eventCounts.get(key) ?? 0) + count);
  }

  private logEvent(eventType: string, payload: JsonValue): void {
    const count = this.eventCounts.get(eventType) ?? 0;

    if (count === 1 || count % 50 === 0) {
      this.options.logger.info({ eventType, count, payload }, "Received user-state event");
      return;
    }

    this.options.logger.debug({ eventType, count, payload }, "Received user-state event");
  }

  private recordAppEvent(
    eventType: string,
    severity: AppEventSeverity,
    message: string,
    payload?: JsonValue
  ): void {
    const record: AppEventRecordInput = {
      bootId: this.options.bootId,
      eventTime: new Date().toISOString(),
      eventType,
      severity,
      component: "exchange.user-state-ws-manager",
      message,
      ...(payload !== undefined ? { payload } : {})
    };

    this.options.appEvents.insert(record);
  }
}
