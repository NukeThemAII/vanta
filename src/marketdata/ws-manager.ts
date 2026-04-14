import type { AllMidsEvent, TradesEvent } from "@nktkas/hyperliquid/api/subscription";
import type { ISubscription, SubscriptionClient, WebSocketTransport } from "@nktkas/hyperliquid";
import type { Logger } from "pino";

import type { FoundationMarket } from "../config/markets.js";
import type { AppEventRecordInput, AppEventSeverity, JsonValue } from "../core/types.js";
import type { MarketDataHealthMonitor, MarketDataHealthSnapshot, MarketDataHealthThresholds } from "./health.js";
import { normalizeAllMidsEvent, normalizeTradesEvent } from "./normalizers.js";
import type { AppEventRepository } from "../persistence/repositories/app-event-repository.js";
import type { MarketEventRepository } from "../persistence/repositories/market-event-repository.js";

interface MarketDataWsManagerOptions {
  readonly bootId: string;
  readonly markets: readonly FoundationMarket[];
  readonly subscriptionClient: SubscriptionClient;
  readonly transport: WebSocketTransport;
  readonly appEvents: AppEventRepository;
  readonly marketEvents: MarketEventRepository;
  readonly healthMonitor: MarketDataHealthMonitor;
  readonly logger: Logger;
  readonly onFatalFailure: (error: Error) => void;
  readonly onTransportOpen?: () => void;
  readonly onTransportClose?: (event: CloseEvent | undefined) => void;
}

export class MarketDataWsManager {
  private readonly subscriptions: ISubscription[] = [];
  private readonly eventCounts = new Map<string, number>();
  private listenersAttached = false;
  private started = false;

  private readonly handleSocketOpen = (): void => {
    this.recordAppEvent("websocket.open", "info", "Subscription transport connected");
    this.options.logger.info("Hyperliquid market data WebSocket connected");
    this.options.onTransportOpen?.();
  };

  private readonly handleSocketClose = (event: Event): void => {
    const closeEvent = event instanceof CloseEvent ? event : undefined;

    this.recordAppEvent("websocket.close", "warn", "Subscription transport closed", {
      code: closeEvent?.code ?? null,
      reason: closeEvent?.reason ?? null,
      wasClean: closeEvent?.wasClean ?? null
    });

    this.options.logger.warn(
      {
        code: closeEvent?.code,
        reason: closeEvent?.reason,
        wasClean: closeEvent?.wasClean
      },
      "Hyperliquid market data WebSocket closed"
    );
    this.options.onTransportClose?.(closeEvent);
  };

  private readonly handleSocketError = (): void => {
    this.recordAppEvent("websocket.error", "error", "Subscription transport emitted an error event");
    this.options.logger.error("Hyperliquid market data WebSocket error");
  };

  private readonly handleSocketTerminate = (event: Event): void => {
    const detail =
      event instanceof CustomEvent && event.detail instanceof Error ? event.detail : new Error("Unknown socket termination");

    this.recordAppEvent("websocket.terminate", "error", "Subscription transport terminated", {
      name: detail.name,
      message: detail.message
    });

    this.options.logger.error({ err: detail }, "Hyperliquid market data WebSocket terminated");
    this.options.onFatalFailure(detail);
  };

  constructor(private readonly options: MarketDataWsManagerOptions) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.attachSocketListeners();
    await this.options.transport.ready();

    const midsSubscription = await this.options.subscriptionClient.allMids((event) => {
      this.handleAllMids(event);
    });
    this.registerSubscription("allMids", midsSubscription);

    for (const market of this.options.markets) {
      const tradesSubscription = await this.options.subscriptionClient.trades({ coin: market }, (event) => {
        this.handleTrades(market, event);
      });

      this.registerSubscription(`trades:${market}`, tradesSubscription);
    }

    this.recordAppEvent("websocket.subscribed", "info", "Registered market data subscriptions", {
      markets: [...this.options.markets],
      subscriptions: ["allMids", ...this.options.markets.map((market) => `trades:${market}`)]
    });

    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started && !this.listenersAttached) {
      return;
    }

    for (const subscription of this.subscriptions.splice(0).reverse()) {
      await subscription.unsubscribe();
    }

    this.detachSocketListeners();
    this.started = false;
  }

  getStats(): Record<string, number> {
    return Object.fromEntries(this.eventCounts);
  }

  getHealthSnapshot(thresholds: MarketDataHealthThresholds, now = new Date()): MarketDataHealthSnapshot {
    return this.options.healthMonitor.getSnapshot(this.options.markets, thresholds, now);
  }

  private attachSocketListeners(): void {
    if (this.listenersAttached) {
      return;
    }

    this.options.transport.socket.addEventListener("open", this.handleSocketOpen);
    this.options.transport.socket.addEventListener("close", this.handleSocketClose);
    this.options.transport.socket.addEventListener("error", this.handleSocketError);
    this.options.transport.socket.addEventListener("terminate", this.handleSocketTerminate);
    this.listenersAttached = true;
  }

  private detachSocketListeners(): void {
    if (!this.listenersAttached) {
      return;
    }

    this.options.transport.socket.removeEventListener("open", this.handleSocketOpen);
    this.options.transport.socket.removeEventListener("close", this.handleSocketClose);
    this.options.transport.socket.removeEventListener("error", this.handleSocketError);
    this.options.transport.socket.removeEventListener("terminate", this.handleSocketTerminate);
    this.listenersAttached = false;
  }

  private handleAllMids(event: AllMidsEvent): void {
    const normalizedEvents = normalizeAllMidsEvent(event, this.options.markets);

    for (const normalizedEvent of normalizedEvents) {
      this.options.healthMonitor.record(normalizedEvent);
      this.options.marketEvents.insert({
        bootId: this.options.bootId,
        ...normalizedEvent
      });

      this.incrementEventCount(`${normalizedEvent.channel}:${normalizedEvent.market}`);
      this.logMarketEvent(normalizedEvent.channel, normalizedEvent.market, normalizedEvent.payload);
    }
  }

  private handleTrades(market: FoundationMarket, trades: TradesEvent): void {
    const normalizedEvent = normalizeTradesEvent(market, trades);

    this.options.healthMonitor.record(normalizedEvent);
    this.options.marketEvents.insert({
      bootId: this.options.bootId,
      ...normalizedEvent
    });

    this.incrementEventCount(`${normalizedEvent.channel}:${normalizedEvent.market}`);
    this.logMarketEvent(normalizedEvent.channel, normalizedEvent.market, normalizedEvent.payload);
  }

  private registerSubscription(label: string, subscription: ISubscription): void {
    subscription.failureSignal.addEventListener(
      "abort",
      () => {
        const detail = subscription.failureSignal.reason;
        const error = detail instanceof Error ? detail : new Error(`Subscription ${label} could not be restored`);

        this.recordAppEvent("subscription.failure", "error", `Subscription failure: ${label}`, {
          label,
          message: error.message
        });

        this.options.logger.error({ err: error, subscription: label }, "Market data subscription failed");
        this.options.onFatalFailure(error);
      },
      { once: true }
    );

    this.subscriptions.push(subscription);
  }

  private incrementEventCount(key: string): void {
    this.eventCounts.set(key, (this.eventCounts.get(key) ?? 0) + 1);
  }

  private logMarketEvent(channel: string, market: FoundationMarket, payload: JsonValue): void {
    const count = this.eventCounts.get(`${channel}:${market}`) ?? 0;
    const logPayload = summarizeLogPayload(channel, payload);

    if (count === 1 || count % 100 === 0) {
      this.options.logger.info({ channel, market, count, payload: logPayload }, "Received market data event");
      return;
    }

    this.options.logger.debug({ channel, market, count, payload: logPayload }, "Received market data event");
  }

  private recordAppEvent(
    eventType: string,
    severity: AppEventSeverity,
    message: string,
    payload?: JsonValue
  ): void {
    const event: AppEventRecordInput = {
      bootId: this.options.bootId,
      eventTime: new Date().toISOString(),
      eventType,
      severity,
      component: "marketdata.ws-manager",
      message,
      ...(payload !== undefined ? { payload } : {})
    };

    this.options.appEvents.insert(event);
  }
}

function summarizeLogPayload(channel: string, payload: JsonValue): JsonValue {
  if (channel !== "trade" || !isJsonObject(payload)) {
    return payload;
  }

  const tradeCount = payload.tradeCount;
  const trades = payload.trades;

  if (typeof tradeCount !== "number" || !Array.isArray(trades)) {
    return payload;
  }

  const lastTrade = trades.at(-1);

  return {
    market: payload.market ?? null,
    tradeCount,
    lastTrade: lastTrade !== undefined && isJsonObject(lastTrade)
      ? {
          px: lastTrade.px ?? null,
          sz: lastTrade.sz ?? null,
          side: lastTrade.side ?? null,
          time: lastTrade.time ?? null
        }
      : null
  };
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
