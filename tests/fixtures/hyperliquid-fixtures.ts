import type { MetaAndAssetCtxsResponse, SpotMetaAndAssetCtxsResponse } from "@nktkas/hyperliquid/api/info";

import { AssetRegistry } from "../../src/exchange/asset-registry.js";

export function makeTestRegistry(): AssetRegistry {
  return AssetRegistry.build({
    network: "testnet",
    perpMetaAndAssetCtxs: makePerpMetaAndCtxs(),
    spotMetaAndAssetCtxs: makeSpotMetaAndCtxs(),
    createdAt: "2026-04-08T10:00:00.000Z"
  });
}

export function makePerpMetaAndCtxs(
  overrides?: Partial<MetaAndAssetCtxsResponse[1][number]>
): MetaAndAssetCtxsResponse {
  return [
    {
      universe: [
        {
          name: "BTC",
          szDecimals: 3,
          maxLeverage: 20,
          marginTableId: 1
        },
        {
          name: "ETH",
          szDecimals: 2,
          maxLeverage: 15,
          marginTableId: 2
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
      },
      {
        prevDayPx: "3300",
        dayNtlVlm: "500000",
        markPx: "3400",
        midPx: "3401",
        funding: "0.0002",
        openInterest: "456",
        premium: null,
        oraclePx: "3399",
        impactPxs: null,
        dayBaseVlm: "200"
      }
    ]
  ];
}

export function makeSpotMetaAndCtxs(
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
