import { createFoundationContainer } from "../app/container.js";
import { loadAppConfig } from "../config/env.js";
import { createLogger } from "../core/logger.js";
import { installRuntimePolyfills } from "../core/runtime.js";
import { DEGRADED_TRUST_EMERGENCY_ACTIONS } from "../exchange/execution-gate.js";
import { deriveMarketDataHealth } from "../marketdata/health.js";

async function main(): Promise<void> {
  installRuntimePolyfills();
  const config = loadAppConfig();
  const logger = createLogger(config);
  const container = createFoundationContainer(config, logger);

  try {
    const accountSnapshot =
      container.reconciliationService.getAccountMirror().getSnapshot()
      ?? container.reconciliationService.getLatestPersistedAccountSnapshot();
    const openOrderSnapshot = container.reconciliationService.getLatestPersistedOpenOrderSnapshot();
    const trustState = container.runtimeTrustController.getSnapshot();
    const recentRiskEvents = container.riskEventRepository.listRecent(10);
    const recentFills =
      config.operatorAddress === undefined ? [] : container.fillRepository.listRecent(config.operatorAddress, 10);
    const latestUserEventTimes =
      config.operatorAddress === undefined ? null : container.userEventRepository.getLatestTimes(config.operatorAddress);
    const dailyClosedPnl =
      config.operatorAddress === undefined ? null : container.fillRepository.sumClosedPnlSince(config.operatorAddress, startOfUtcDayMs());
    const weeklyClosedPnl =
      config.operatorAddress === undefined ? null : container.fillRepository.sumClosedPnlSince(config.operatorAddress, startOfUtcWeekMs());
    const marketDataHealth = deriveMarketDataHealth({
      markets: config.watchedMarkets,
      latestTimes: container.marketEventRepository.getLatestTimes(),
      thresholds: {
        maxMidAgeMs: config.risk.marketDataMaxMidAgeMs,
        maxTradeAgeMs: config.risk.marketDataMaxTradeAgeMs
      }
    });

    console.log(
      JSON.stringify(
        {
          network: config.network.name,
          operatorAddress: config.operatorAddress ?? null,
          trustState,
          executionPolicy: {
            trusted: "all_write_actions",
            degraded: [...DEGRADED_TRUST_EMERGENCY_ACTIONS],
            untrusted: []
          },
          riskConfig: config.risk,
          account: accountSnapshot === undefined
            ? null
            : {
                syncedAt: accountSnapshot.syncedAt,
                staleness: accountSnapshot.staleness,
                accountValue: accountSnapshot.marginSummary.accountValue,
                positionCount: accountSnapshot.positions.length,
                withdrawable: accountSnapshot.withdrawable
              },
          openOrders: openOrderSnapshot === undefined
            ? null
            : {
                syncedAt: openOrderSnapshot.syncedAt,
                orderCount: openOrderSnapshot.orders.length
              },
          realizedPnl: {
            dailyClosedPnl,
            weeklyClosedPnl,
            recentFillCount: recentFills.length
          },
          marketDataHealth,
          latestUserEventTimes,
          recentFills,
          recentRiskEvents
        },
        null,
        2
      )
    );
  } finally {
    await container.exchangeClient.close();
    container.database.close();
  }
}

await main();

function startOfUtcDayMs(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function startOfUtcWeekMs(now = new Date()): number {
  const dayOfWeek = now.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday);
}
