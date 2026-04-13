import type { FrontendOpenOrdersResponse } from "@nktkas/hyperliquid/api/info";
import { describe, expect, it } from "vitest";

import { AssetRegistry } from "../../../src/exchange/asset-registry.js";
import {
  determineTrustStateAfterReconciliation,
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
