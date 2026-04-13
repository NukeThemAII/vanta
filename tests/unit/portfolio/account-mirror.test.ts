import type {
  ClearinghouseStateResponse,
  SpotClearinghouseStateResponse,
  UserRateLimitResponse
} from "@nktkas/hyperliquid/api/info";
import { describe, expect, it } from "vitest";

import { AssetRegistry } from "../../../src/exchange/asset-registry.js";
import { normalizeAccountSnapshot } from "../../../src/portfolio/account-mirror.js";

describe("normalizeAccountSnapshot", () => {
  it("maps Hyperliquid account state into the local account mirror", () => {
    const registry = AssetRegistry.build({
      network: "testnet",
      perpMetaAndAssetCtxs: [
        {
          universe: [
            {
              name: "ETH",
              szDecimals: 3,
              maxLeverage: 15,
              marginTableId: 2
            }
          ],
          marginTables: [],
          collateralToken: 0
        },
        [
          {
            prevDayPx: "2000",
            dayNtlVlm: "1000000",
            markPx: "2050",
            midPx: "2051",
            funding: "0.0002",
            openInterest: "100",
            premium: null,
            oraclePx: "2049",
            impactPxs: null,
            dayBaseVlm: "500"
          }
        ]
      ],
      spotMetaAndAssetCtxs: [
        {
          universe: [],
          tokens: [
            {
              name: "USDC",
              szDecimals: 2,
              weiDecimals: 6,
              index: 0,
              tokenId: "0x00000000000000000000000000000001",
              isCanonical: true,
              evmContract: null,
              fullName: "USD Coin",
              deployerTradingFeeShare: "0"
            }
          ]
        },
        []
      ],
      createdAt: "2026-04-05T10:00:00.000Z"
    });

    const snapshot = normalizeAccountSnapshot({
      operatorAddress: "0x1111111111111111111111111111111111111111",
      network: "testnet",
      source: "rest_reconciliation",
      syncedAt: "2026-04-05T10:00:00.000Z",
      registry,
      clearinghouseState: makeClearinghouseState(),
      spotState: makeSpotState(),
      userRateLimit: makeUserRateLimit()
    });

    expect(snapshot.marginModeAssumption).toBe("cross-only-mvp");
    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.positions[0]?.assetId).toBe(0);
    expect(snapshot.positions[0]?.direction).toBe("long");
    expect(snapshot.positions[0]?.leverageType).toBe("cross");
    expect(snapshot.spotBalances[0]?.coin).toBe("USDC");
    expect(snapshot.rateLimit?.requestsCap).toBe(1000);
  });
});

function makeClearinghouseState(): ClearinghouseStateResponse {
  return {
    marginSummary: {
      accountValue: "1000",
      totalNtlPos: "100",
      totalRawUsd: "1000",
      totalMarginUsed: "50"
    },
    crossMarginSummary: {
      accountValue: "1000",
      totalNtlPos: "100",
      totalRawUsd: "1000",
      totalMarginUsed: "50"
    },
    crossMaintenanceMarginUsed: "10",
    withdrawable: "900",
    assetPositions: [
      {
        type: "oneWay",
        position: {
          coin: "ETH",
          szi: "1.5",
          leverage: {
            type: "cross",
            value: 5
          },
          entryPx: "2000",
          positionValue: "3000",
          unrealizedPnl: "50",
          returnOnEquity: "0.05",
          liquidationPx: "1500",
          marginUsed: "100",
          maxLeverage: 15,
          cumFunding: {
            allTime: "1",
            sinceOpen: "0.5",
            sinceChange: "0.1"
          }
        }
      }
    ],
    time: 1775383200000
  };
}

function makeSpotState(): SpotClearinghouseStateResponse {
  return {
    balances: [
      {
        coin: "USDC",
        token: 0,
        total: "1000",
        hold: "10",
        entryNtl: "1000"
      }
    ]
  };
}

function makeUserRateLimit(): UserRateLimitResponse {
  return {
    cumVlm: "10000",
    nRequestsUsed: 10,
    nRequestsCap: 1000,
    nRequestsSurplus: 990
  };
}
