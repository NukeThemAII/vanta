import type { MetaAndAssetCtxsResponse, SpotMetaAndAssetCtxsResponse } from "@nktkas/hyperliquid/api/info";
import { describe, expect, it } from "vitest";

import { AssetRegistry } from "../../../src/exchange/asset-registry.js";
import { diffAssetRegistry } from "../../../src/exchange/reconciliation.js";

describe("AssetRegistry", () => {
  it("builds centralized perp and spot asset resolution with Hyperliquid asset ids", () => {
    const registry = AssetRegistry.build({
      network: "testnet",
      perpMetaAndAssetCtxs: makePerpMetaAndCtxs(),
      spotMetaAndAssetCtxs: makeSpotMetaAndCtxs(),
      createdAt: "2026-04-05T10:00:00.000Z"
    });

    const btcPerp = registry.requirePerpBySymbol("BTC");
    const spotPair = registry.getSpotBySymbol("PURR/USDC");
    const purrToken = registry.getSpotToken(1);

    expect(btcPerp.assetId).toBe(0);
    expect(btcPerp.precision.priceMaxDecimals).toBe(3);
    expect(spotPair?.assetId).toBe(10007);
    expect(spotPair?.baseSymbol).toBe("PURR");
    expect(spotPair?.quoteSymbol).toBe("USDC");
    expect(spotPair?.precision.sizeDecimals).toBe(2);
    expect(purrToken?.symbol).toBe("PURR");
    expect(registry.getByAssetId(10007)?.symbol).toBe("PURR/USDC");
  });

  it("ignores volatile market context when diffing registry snapshots", () => {
    const previousSnapshot = AssetRegistry.build({
      network: "testnet",
      perpMetaAndAssetCtxs: makePerpMetaAndCtxs(),
      spotMetaAndAssetCtxs: makeSpotMetaAndCtxs(),
      createdAt: "2026-04-05T10:00:00.000Z"
    }).getSnapshot();

    const currentSnapshot = AssetRegistry.build({
      network: "testnet",
      perpMetaAndAssetCtxs: makePerpMetaAndCtxs({
        markPx: "68100",
        midPx: "68101",
        funding: "0.0002"
      }),
      spotMetaAndAssetCtxs: makeSpotMetaAndCtxs({
        markPx: "0.25",
        midPx: "0.26",
        dayNtlVlm: "1500"
      }),
      createdAt: "2026-04-05T10:05:00.000Z"
    }).getSnapshot();

    expect(diffAssetRegistry(previousSnapshot, currentSnapshot)).toHaveLength(0);
  });
});

function makePerpMetaAndCtxs(overrides?: Partial<MetaAndAssetCtxsResponse[1][number]>): MetaAndAssetCtxsResponse {
  return [
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
        dayBaseVlm: "100",
        ...overrides
      }
    ]
  ];
}

function makeSpotMetaAndCtxs(
  overrides?: Partial<SpotMetaAndAssetCtxsResponse[1][number]>
): SpotMetaAndAssetCtxsResponse {
  return [
    {
      universe: [
        {
          tokens: [1, 0],
          name: "PURR/USDC",
          index: 7,
          isCanonical: true
        }
      ],
      tokens: [
        {
          name: "USDC",
          szDecimals: 2,
          weiDecimals: 6,
          index: 0,
          tokenId: "0x00000000000000000000000000000001",
          isCanonical: true,
          evmContract: {
            address: "0x1111111111111111111111111111111111111111",
            evm_extra_wei_decimals: 0
          },
          fullName: "USD Coin",
          deployerTradingFeeShare: "0"
        },
        {
          name: "PURR",
          szDecimals: 2,
          weiDecimals: 6,
          index: 1,
          tokenId: "0x00000000000000000000000000000002",
          isCanonical: true,
          evmContract: {
            address: "0x2222222222222222222222222222222222222222",
            evm_extra_wei_decimals: 0
          },
          fullName: "Purr",
          deployerTradingFeeShare: "0"
        }
      ]
    },
    [
      {
        prevDayPx: "0.1",
        dayNtlVlm: "1000",
        markPx: "0.2",
        midPx: "0.21",
        circulatingSupply: "500000",
        coin: "PURR/USDC",
        totalSupply: "1000000",
        dayBaseVlm: "120",
        ...overrides
      }
    ]
  ];
}
