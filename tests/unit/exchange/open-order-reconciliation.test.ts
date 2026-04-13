import type { FrontendOpenOrdersResponse } from "@nktkas/hyperliquid/api/info";
import { describe, expect, it } from "vitest";

import { AssetRegistry } from "../../../src/exchange/asset-registry.js";
import {
  determineTrustStateAfterReconciliation,
  diffAccountSnapshots,
  diffActiveOrderStatesAgainstOpenOrders,
  diffOpenOrderSnapshots,
  summarizeReconciliationIssues
} from "../../../src/exchange/reconciliation.js";
import { normalizeOpenOrderSnapshot } from "../../../src/exchange/open-order-mirror.js";

describe("open-order reconciliation", () => {
  it("detects drift between the last persisted open-order snapshot and the exchange snapshot", () => {
    const registry = AssetRegistry.build({
      network: "testnet",
      perpMetaAndAssetCtxs: [
        {
          universe: [
            {
              name: "BTC",
              szDecimals: 3,
              maxLeverage: 20,
              marginTableId: 1
            }
          ],
          marginTables: [],
          collateralToken: 0
        },
        [
          {
            prevDayPx: "67000",
            dayNtlVlm: "1000000",
            markPx: "68000",
            midPx: "68001",
            funding: "0.0001",
            openInterest: "123",
            premium: null,
            oraclePx: "67999",
            impactPxs: null,
            dayBaseVlm: "100"
          }
        ]
      ],
      spotMetaAndAssetCtxs: [
        {
          universe: [],
          tokens: []
        },
        []
      ],
      createdAt: "2026-04-05T10:00:00.000Z"
    });

    const previousSnapshot = normalizeOpenOrderSnapshot({
      operatorAddress: "0x1111111111111111111111111111111111111111",
      network: "testnet",
      source: "rest_reconciliation",
      syncedAt: "2026-04-05T10:00:00.000Z",
      registry,
      openOrders: makeOpenOrders("3500")
    });

    const currentSnapshot = normalizeOpenOrderSnapshot({
      operatorAddress: "0x1111111111111111111111111111111111111111",
      network: "testnet",
      source: "rest_reconciliation",
      syncedAt: "2026-04-05T10:10:00.000Z",
      registry,
      openOrders: makeOpenOrders("3600")
    });

    const issues = diffOpenOrderSnapshots(previousSnapshot, currentSnapshot);
    const summary = summarizeReconciliationIssues(issues);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.issueType).toBe("open_order_changed");
    expect(summary.warningCount).toBe(1);
    expect(
      determineTrustStateAfterReconciliation({
        operatorConfigured: true,
        issues
      })
    ).toBe("trusted");
  });

  it("treats unexpected position drift as an error that untrusts the runtime", () => {
    const previousAccount = {
      operatorAddress: "0x1111111111111111111111111111111111111111",
      network: "testnet",
      source: "rest_reconciliation",
      syncedAt: "2026-04-05T10:00:00.000Z",
      staleness: {
        isStale: false,
        thresholdMs: 30000,
        ageMs: 0
      },
      marginModeAssumption: "cross",
      marginSummary: {
        accountValue: "1000",
        totalMarginUsed: "100",
        withdrawable: "900"
      },
      crossMarginSummary: null,
      withdrawable: "900",
      positions: [],
      spotBalances: [],
      rateLimit: null
    } as const;

    const currentAccount = {
      ...previousAccount,
      positions: [
        {
          marketSymbol: "BTC",
          assetId: 0,
          side: "long",
          size: "0.01",
          entryPrice: "68000",
          positionValue: "680",
          unrealizedPnl: "0",
          returnOnEquity: "0",
          liquidationPrice: null,
          leverage: {
            type: "cross",
            value: 2
          },
          marginUsed: "340",
          maxLeverage: 20,
          cumulativeFunding: {
            allTime: "0",
            sinceOpen: "0",
            sinceChange: "0"
          }
        }
      ]
    } as const;

    const issues = diffAccountSnapshots(previousAccount, currentAccount);

    expect(issues[0]?.severity).toBe("error");
    expect(
      determineTrustStateAfterReconciliation({
        operatorConfigured: true,
        issues
      })
    ).toBe("untrusted");
  });

  it("detects drift between local active order-state records and exchange open orders", () => {
    const registry = AssetRegistry.build({
      network: "testnet",
      perpMetaAndAssetCtxs: [
        {
          universe: [
            {
              name: "BTC",
              szDecimals: 3,
              maxLeverage: 20,
              marginTableId: 1
            }
          ],
          marginTables: [],
          collateralToken: 0
        },
        [
          {
            prevDayPx: "67000",
            dayNtlVlm: "1000000",
            markPx: "68000",
            midPx: "68001",
            funding: "0.0001",
            openInterest: "123",
            premium: null,
            oraclePx: "67999",
            impactPxs: null,
            dayBaseVlm: "100"
          }
        ]
      ],
      spotMetaAndAssetCtxs: [
        {
          universe: [],
          tokens: []
        },
        []
      ],
      createdAt: "2026-04-05T10:00:00.000Z"
    });

    const exchangeSnapshot = normalizeOpenOrderSnapshot({
      operatorAddress: "0x1111111111111111111111111111111111111111",
      network: "testnet",
      source: "rest_reconciliation",
      syncedAt: "2026-04-05T10:10:00.000Z",
      registry,
      openOrders: makeOpenOrders("3600")
    });

    const issues = diffActiveOrderStatesAgainstOpenOrders(
      [
        {
          orderKey: "cloid:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          operatorAddress: "0x1111111111111111111111111111111111111111",
          marketSymbol: "ETH",
          assetId: 1,
          marketType: "perp",
          state: "resting",
          side: "sell",
          clientOrderId: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          limitPrice: "4200",
          originalSize: "0.5",
          filledSize: "0",
          lastSource: "exchange_ack",
          updatedAt: "2026-04-05T10:05:00.000Z"
        }
      ],
      exchangeSnapshot
    );

    expect(issues.map((issue) => issue.issueType)).toEqual([
      "local_active_order_missing_on_exchange",
      "exchange_open_order_missing_locally"
    ]);
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);
  });
});

function makeOpenOrders(limitPrice: string): FrontendOpenOrdersResponse {
  return [
    {
      coin: "BTC",
      side: "B",
      limitPx: limitPrice,
      sz: "0.01",
      oid: 1,
      timestamp: 1775383200000,
      origSz: "0.01",
      triggerCondition: "",
      isTrigger: false,
      triggerPx: "",
      children: [],
      isPositionTpsl: false,
      reduceOnly: false,
      orderType: "Limit",
      tif: "Gtc",
      cloid: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ];
}
