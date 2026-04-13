# AUDIT.md — Vanta-HL Industry Standards Audit

**Audited:** 2026-04-13 (v2 — updated post Phase 4)
**Auditor:** Antigravity (AI Engineering Partner)
**Scope:** Full repository audit against industry standards for production-grade algorithmic trading systems.
**Phases completed (per LOG.md):** Phase 1 (Foundation), Phase 2 (Exchange State & Recovery), Phase 3 (Write-Side Execution) + Phase 3 post-audit hardening, Phase 4 (Risk Engine — first slice)
**Phases outstanding:** Phase 4 remaining guards (drawdown, cooldown, funding), Phase 5 (Strategy Runtime), Phase 6 (Telegram), Phase 7 (Hardening)

---

## Changelog vs. v1 Audit

| Finding | Status |
|---|---|
| P0 · Fix `-1` fallback in `mapFormattedModifyToSdk` | ✅ **Fixed** — now throws if neither `clientOrderId` nor `orderId` is present |
| P0 · Add `listActiveOrders()` to `OrderStateRepository` | ✅ **Fixed** — implemented and used by risk engine |
| G-2 · No risk engine | ✅ **Phase 4 in progress** — `RiskEngine` + 4 guard modules shipped |
| RC-1 · Reconciliation does not compare local `order_state_records` vs exchange | ✅ **Fixed** — reconciliation now raises errors for local orders missing on exchange and vice versa |
| RC-3 · Position drift is warn-only | ✅ **Fixed** — position drift now escalated to `error` severity causing `untrusted` state |
| TS-3 · No migration system | ❌ Still open |
| DB-2 · `market_events` unbounded growth | ❌ Still open |
| DB-4 · No `fills` table | ❌ Still open |
| OPS-1 · No systemd unit file | ❌ Still open |
| OPS-4 · No paper-trading mode | ❌ Still open |
| EX-1 · `ExecutionGate` testnet hardcode | ❌ Still open |
| EX-2 · No batch cancel / batch modify | ❌ Still open |
| EX-3 · No dead-man's switch auto-refresh | ❌ Still open |
| TEST-3 · Write smoke test never run with real credentials | ❌ Still open |

---

## Executive Summary

Vanta continues to mature rapidly and with engineering discipline. The post-audit Phase 3
hardening session resolved the most critical code defects flagged in v1. Phase 4 then delivered
a real risk engine with four guard modules, Zod-validated risk configuration, a persisted risk
decision log, and a read-only `state:risk` CLI command.

The codebase is now closer to a production-viable foundation than most trading systems at this
stage. The architecture remains clean, the guard pattern is composable, and risk decisions are
fully auditable in SQLite.

The bot still cannot trade because strategies, the intent layer, candle recorder, and Telegram
are absent. Phase 4 itself is still partial — drawdown stops, consecutive-loss cooldowns,
funding guards, and rate-limit headroom guards are not yet implemented. However, the path from
here to a first live testnet trade with real capital is clearly scoped and unblocked.

**Overall grade: A- (excellent foundations + working risk gate; missing second half of Phase 4
and all of Phase 5–6)**

---

## 1. Architecture & Module Design

### ✅ Strengths (updated)

| Area | Assessment |
|---|---|
| Module separation | Outstanding. `src/risk/` is a completely isolated package. `RiskEngine` never calls exchange or Telegram. Guards are pure functions. |
| Risk as a mandatory gate | `RiskEngine` is wired between `ExecutionEngine`'s intent intake and its actual write primitives. No caller can bypass it. |
| Guard composability | Each guard (`exposure.ts`, `leverage.ts`, `slippage.ts`, `stale-state.ts`) is a pure function returning a typed result object. Adding a new guard is a 20-line addition. |
| Configurable risk parameters | All risk limits are first-class env vars validated by Zod, matching the established config pattern exactly. No magic numbers. |
| Risk decision persistence | `risk_event_records` table captures every approve/adjust/reject with guard outcomes, market context, trust state, and details. Full audit trail. |
| Stop-based sizing with cap mode | `evaluateStopBasedSizing` can reject (default) or cap (opt-in `sizingMode: "cap"`) oversized entries based on stop distance. Clean separation of policy from mechanism. |

### ⚠️ Gaps & Issues (updated)

**G-1 — No strategy module exists (Phase 5 gap)**
`src/strategies/` is still missing. No strategy plugin interface, no `trend-pullback-v1`.

**G-3 — No intent translation layer**
`src/intents/` still does not exist. The risk engine currently accepts `FormattedOrderRequest`
directly, which means it is coupled to execution format rather than strategy intent format.
This design is correct for Phase 4 (strategies aren't built yet) but must be addressed in Phase 5.

**G-4 — `FoundationContainer` is growing**
`container.ts` now wires 20+ objects including the `RiskEngine`. As Phase 5–6 objects are added
(strategy runtime, candle store, Telegram bot), the flat container will become a maintenance
burden. Consider layering: `InfraContainer → ExchangeContainer → RiskContainer → TradingContainer`.

**G-5 — No market-to-strategy config**
`src/config/strategy-maps.ts` still does not exist. The risk engine currently has no concept of
which markets have an active strategy or which strategies are enabled. Important for Phase 5.

**G-6 — No candle/book/trade recorder (unchanged, hard requirement)**
`src/marketdata/` still has only `ws-manager.ts` and `normalizers.ts`. There is no structured
candle store. All indicators for `trend-pullback-v1` must be computed from historical candle
data. This is a Phase 5 blocker.

**G-7 — Phase 4 risk engine is only partial (Phase 4 own admission)**
Per LOG.md, the following guards are explicitly missing:
- drawdown stops (daily/weekly PnL limits)
- consecutive-loss cooldowns
- funding-based entry blocking
- rate-limit headroom guard
- stale-market-data / book-quality guards

The risk engine rejects based on static account state but has no temporal awareness of
drawdown trajectory or funding conditions.

---

## 2. TypeScript & Code Quality

### ✅ Strengths (unchanged)

Maximum-strictness TypeScript config. Readonly-first. No `any` in critical paths. BigInt
decimals throughout the risk guard math. ESLint wired.

### ⚠️ Issues (updated)

**TS-1 — `asJsonValue()` escape hatch (unchanged)**
Still present. Risk guard details are persisted via `asJsonValue(details)` where `details` is
`Record<string, unknown>`. The structured guard detail objects are well-typed internally but
become untyped JSON blobs in the database. Acceptable for now but will make data forensics
harder over time.

**TS-2 — Fixed ✅**
The `-1` fallback in `mapFormattedModifyToSdk` was removed. The function now throws if neither
`clientOrderId` nor `orderId` is present.

**TS-3 — Schema tables still have no migration system**
`schema.ts` uses `CREATE TABLE IF NOT EXISTS`. The new `risk_event_records` table was added
via a new `CREATE TABLE IF NOT EXISTS` statement with no versioning. This compounds the risk of
schema drift on existing databases. Critical to address before Phase 5.

**TS-4 — No lint / typecheck in CI or pre-commit**
Unchanged. Still no husky, lint-staged, or CI pipeline.

**TS-5 — `leverage.ts` hardcodes "Phase 4" in a reject message**

```typescript
message: "Phase 4 leverage updates are restricted to cross margin"
```

This string will become misleading in production once Phase 4 is complete. The message should
describe the actual policy (cross-margin only for MVP), not reference a development phase.

---

## 3. Persistence & Database

### ✅ Strengths (updated)

17 well-named tables now. `risk_event_records` adds a proper decision audit trail. All hot
query paths have indexes. Repository pattern is consistent throughout including the new
`RiskEventRepository`.

### ⚠️ Issues (updated)

**DB-1 — No migration versioning (unchanged)**
Critical. Phase 4 added a new table via appended `CREATE TABLE IF NOT EXISTS`. Without a
migration runner, no existing bot instance can upgrade its schema automatically.

**DB-2 — `market_events` unbounded growth (unchanged)**
No retention policy, no TTL. Still the highest-risk operational issue before any sustained run.

**DB-3 — No dedicated `fills` table (unchanged)**
Individual fills still only appear as `order_state_transitions` rows with `source = "user_fill"`.
PnL computation and the drawdown guard (Phase 4 remaining) will need fill data in a queryable
form. This is now more pressing given that drawdown stops are next.

**DB-4 — `risk_event_records` has no index on common query paths**

```sql
CREATE TABLE IF NOT EXISTS risk_event_records (...)
```

Checking the schema: there is no index on `(operator_address, occurred_at DESC)` or on
`(decision, occurred_at DESC)`. As risk decisions accumulate, `listRecent()` scans the full
table via `ORDER BY id DESC LIMIT ?` which is fine for a small table but will degrade as
thousands of decisions accumulate per day. Add at minimum `idx_risk_event_records_occurred_at`.

**DB-5 — `RiskEventRepository.listRecent()` is the only query**
There is no query for rejected decisions by market, no time-range query, and no count-by-decision
query. The `state:risk` CLI can only show the most recent N decisions. For drawdown stop
computation and consecutive-loss cooldowns, the risk engine will need more targeted queries
(e.g., `listRejectedSince(timestamp)` or `countConsecutiveLosses(market, since)`).

---

## 4. Exchange Integration

### ✅ Strengths (unchanged)

Correct nktkas SDK usage, cloid centralization, nonce isolation, order formatting, dead-man's
switch primitive all remain as previously assessed.

### ⚠️ Issues (updated)

**EX-1 — `ExecutionGate` testnet hardcode (unchanged)**
The `"Phase 3 write actions are restricted to testnet"` throw remains. Must become a
`config.allowMainnetWrites` flag before any mainnet deployment planning.

**EX-2 — No batch cancel / batch modify (unchanged)**
Still only single-order operations. Critical for risk emergency stops and strategy shutdown.

**EX-3 — Dead-man's switch not auto-refreshed (unchanged)**
The `scheduleCancel` primitive exists but there is no service that refreshes it on a timer.

**EX-4 — No rate-limit headroom guard (unchanged)**
Still no guard on WebSocket or REST rate budget. Acknowledged in Phase 4 scope as outstanding.

**EX-5 — `RiskEngine.requirePerpAsset` always rejects non-perp assets**
```typescript
if (asset === undefined || asset.kind !== "perp") { ... }
```
This is a deliberate Phase 4 restriction (perps only). The rejection message says
"Phase 4 risk engine supports perps only". This hard restriction must be cleaned up before
any spot or HIP-3 perp trading is introduced. It should become a policy flag not a hardcoded
throw.

---

## 5. Risk Engine (New Section)

### ✅ What's well-implemented

| Guard | Coverage | Assessment |
|---|---|---|
| `evaluateFreshAccountState` | Rejects if snapshot is undefined or stale | Correct. First guard in every `evaluatePlaceOrder` call. |
| `evaluateOpenOrderLimit` | Rejects if active order count ≥ max | Correct. Uses `listActiveOrders()` from SQLite. |
| `evaluateConcurrentPositionLimit` | Rejects if concurrent positions ≥ max for new exposure | Correct. Skip for reduce-only orders. |
| `evaluateMaxOrderNotional` | Rejects if `price × size > maxOrderNotionalUsd` | Correct. Skip for reduce-only orders. |
| `evaluatePriceDeviation` | Rejects aggressive prices > maxBps from mid/mark/oracle | Correct. Skip for passive (Alo) orders. |
| `evaluateLeverageLimit` | Rejects if leverage > exchange max × fraction | Correct. Cross-margin only enforced. |
| `evaluateStopBasedSizing` | Rejects or caps position size to risk budget via stop distance | Well-implemented with cap mode support. |

### ⚠️ Risk Engine Issues

**RISK-1 — Guard order for `evaluatePlaceOrder` could reject before cheaper checks**
Current guard sequence: stale-state → stop-sizing → open-order-limit → position-limit →
max-notional → slippage. Stale-state is correctly first (cheapest and most critical). But
stop-sizing (which involves divisions and formatting) runs before the cheap open-order-limit
and position-limit integer comparisons. Reordering to: stale-state → open-order-limit →
position-limit → max-notional → slippage → stop-sizing would be more efficient.

**RISK-2 — No drawdown stops (Phase 4 gap)**
There is no guard that tracks cumulative realized PnL losses within a session, day, or week.
Without drawdown stops, the engine could allow unlimited sequential losing trades. This is the
most critical missing Phase 4 guard.

**RISK-3 — No consecutive-loss cooldown (Phase 4 gap)**
No guard tracks consecutive rejected entries or consecutive stopped-out trades and enforces a
cooling-off period. This is explicitly listed in AGENTS.md and LOG.md as outstanding.

**RISK-4 — No funding guard (Phase 4 gap)**
No guard checks current or predicted funding rates against the proposed trade direction.
Entering a long when funding is extremely positive (longs paying heavily) is a known risk
deduction from the AGENTS.md design.

**RISK-5 — `resolveReferencePrice` fallback chain is order-dependent**

```typescript
function resolveReferencePrice(asset: PerpAssetRecord): string {
  return asset.context.midPrice ?? asset.context.markPrice ?? asset.context.oraclePrice;
}
```

`oraclePrice` is a guaranteed non-null field. `midPrice` may be `null` or absent during thin
markets. The fallback chain is correct in priority but there is no log or warning when `midPrice`
is unavailable and `markPrice` / `oraclePrice` is used instead. A latent deviation in `midPrice`
vs `oraclePrice` could cause the slippage guard to pass orders that would fail against a real
live mid. Consider logging a warning when falling back.

**RISK-6 — `RiskEngine` is missing from `FoundationContainer` interface**
The container creates a `RiskEngine` but it is not returned in the `FoundationContainer`
interface — only used internally by `ExecutionEngine`. This is correct for now (the risk engine
is an implementation detail) but means operator tooling (`state:risk` CLI) must reconstruct
its own risk view from raw repositories rather than querying a live engine. Not a bug, but
worth noting for when the strategy runtime needs to query risk state.

---

## 6. Reconciliation & State Recovery

### ✅ Improvements since v1

- **RC-1 fixed**: Reconciliation now compares local non-terminal `order_state_records` against
  the exchange's authoritative open-order snapshot. Explicit errors for:
  - local active orders missing on exchange
  - exchange open orders missing from local records
- **RC-3 fixed**: Position additions/removals/changes now produce `error`-severity issues,
  which push the runtime to `untrusted` state.

### ⚠️ Remaining Issues

**RC-2 — No watchdog for WebSocket silence during live trading (unchanged)**
Once `trusted`, the runtime stays `trusted` until the next explicit reconciliation. No timer-based
degradation if fills stop arriving during a live session.

---

## 7. Security (unchanged from v1)

All previously noted strengths remain. All previously noted risks remain open:

- SEC-1: Private key in heap for full process lifetime — acceptable for MVP VPS, must be documented.
- SEC-2: Telegram auth not yet built — must be first-class in Phase 6.
- SEC-3: SQLite plaintext — `data/` needs `chmod 700` on VPS.
- SEC-4: No secrets scanning in CI.

---

## 8. Testing

### ✅ Improvements since v1

| Addition | Quality |
|---|---|
| `tests/unit/risk/risk-engine.test.ts` | 6 scenarios covering stale state, size capping, notional rejection, open-order limit, price deviation, and leverage cap. Uses real SQLite (`:memory:`). Excellent. |
| `tests/unit/exchange/open-order-reconciliation.test.ts` | New coverage for local-vs-exchange order drift detection. |
| `tests/unit/persistence/order-state-repository.test.ts` | New coverage for `listActiveOrders()`. |
| `tests/unit/config/env.test.ts` | Expanded with risk config env vars. |
| `tests/unit/exchange/execution-gate.test.ts` | Expanded. |

### ⚠️ Issues (updated)

**TEST-1 — No integration tests (unchanged)**
No integration tests against real SQLite, mock exchange, or full reconciliation flow.

**TEST-2 — No property-based tests for `decimal.ts` (unchanged)**
`fast-check` still not added. The stop-based sizing math heavily relies on BigInt decimal
arithmetic and would benefit greatly from property-based tests.

**TEST-3 — Write smoke test never run with real credentials (unchanged)**
Still the single most important missing verification before Phase 4 is considered complete.
The full `place → ack → fill/cancel` lifecycle with the new risk-gated path has not been
exercised end-to-end with a real funded testnet account.

**TEST-4 — Risk engine tests cover happy-path approval minimally**
The risk engine tests cover all reject/adjust cases well. But there is no test that verifies
a complete happy-path `evaluatePlaceOrder → evaluateModifyOrder → cancel` sequence that exercises
the persistence of the approval record in `risk_event_records`. Adding an "approves a valid
small reduce-only order" test would complete the coverage picture.

**TEST-5 — No coverage threshold enforced (unchanged)**
No minimum coverage threshold in `vitest.config.ts`.

---

## 9. Operational Readiness

### ✅ Improvements since v1

- **`pnpm state:risk`** — read-only CLI that prints current trust state, active risk config,
  latest account/order snapshot summary, and recent risk decisions. Very useful for production
  ops.
- **Risk config in `.env.example`** — all 7 new `VANTA_RISK_*` variables are documented.

### ⚠️ Issues (updated)

**OPS-1 — No systemd unit file (unchanged)**
Still no `.service` file.

**OPS-2 — No Telegram bot (Phase 6 gap, unchanged)**
Emergency controls still require direct VPS SSH access.

**OPS-3 — No metrics collection (unchanged)**
`src/services/metrics.ts` still absent.

**OPS-4 — No paper-trading mode (unchanged)**
`src/cli/run-paper.ts` still does not exist.

**OPS-5 — No data retention policy (unchanged)**
`market_events`, `user_event_records`, and `order_state_transitions` grow without bound.

**OPS-6 — Risk rejections are logged + persisted but no live alert (unchanged)**
`RiskEngine.reject()` logs at `warn` level and persists the decision, but there is no hook
to alert the operator via Telegram when a live trade is rejected. In production, silent
rejections during a strategy's intended entry window are operationally critical to know about.

---

## 10. Dependency & Package Hygiene (updated)

| Package | Version | Assessment |
|---|---|---|
| `@nktkas/hyperliquid` | `^0.32.2` | Correct. Pin to exact version before mainnet. |
| `better-sqlite3` | `^12.8.0` | Good. |
| `pino` | `^10.3.1` | Good. |
| `viem` | `^2.39.0` | Good. |
| `zod` | `^4.3.6` | Good. Risk config uses it correctly. |
| `grammy` | — | **Missing.** Phase 6 dependency. |
| `fast-check` | — | Not present. Recommended for decimal/risk guard property tests. |
| Migration tool | — | Not present. Urgently needed before Phase 5 schema changes. |

---

## 11. Adherence to AGENTS.md (updated)

| Requirement | Status |
|---|---|
| Testnet first | ✅ Enforced by `ExecutionGate` hardcode |
| Perps first | ✅ Risk engine explicitly perps-only for Phase 4 |
| nktkas SDK integration | ✅ Used correctly throughout |
| No AI in live path | ✅ No AI calls anywhere in execution path |
| Strategy plugin contract | ❌ `src/strategies/` does not exist |
| Risk engine is final authority | ✅ **Now enforced** — `RiskEngine` gates all write primitives |
| One responsibility per module | ✅ Excellent adherence |
| No hidden mutable state | ✅ All state reconstructable from SQLite |
| No placeholder architecture | ⚠️ intents, strategies, candle-store still missing |
| LOG.md maintained | ✅ Both post-audit sessions recorded in detail |
| Strict typing | ✅ Near-maximal TypeScript strictness |
| Operational safety first | ✅ Trust gating, reconciliation-first, risk gating now in place |
| `cloid` contract | ✅ Centralized, 16-byte hex enforced |
| Dead-man's switch | ⚠️ Primitive exists, no auto-refresh loop |
| Candle history (hard requirement) | ❌ Candle recorder does not exist |
| systemd deployment | ❌ No `.service` file |
| Strategy → intent pipeline | ❌ Intents layer does not exist |
| Batch cancel/modify | ❌ Only single-order operations |
| Drawdown / cooldown guards | ❌ Phase 4 guards still outstanding |
| Funding guard | ❌ Phase 4 guard still outstanding |

---

## 12. Prioritized Recommendations (updated)

### P0 — Must fix before any live run

1. **Run the full write smoke test with a real funded testnet account.** This remains the
   single highest-priority unresolved verification item. The risk-gated `place → ack → fill/cancel`
   lifecycle must be exercised with a real funded account before Phase 5 work can safely assume
   the write path is correct.
2. **Add a basic data retention policy.** Cap `market_events` and `user_event_records` at 7 days.
   A simple DELETE on startup prevents runaway SQLite growth.
3. **Add index on `risk_event_records.occurred_at`.** Without it, `ORDER BY id DESC LIMIT ?`
   will degrade as decisions accumulate.
4. **Fix the "Phase 4" string in `leverage.ts` guard message.** Replace with policy language:
   `"Cross-margin is required for leverage updates in MVP mode"`.

### P1 — Complete Phase 4

5. **Drawdown stop guard.** Track cumulative realized PnL within a session and day; reject new
   non-reduce-only entries once a configured loss threshold is hit.
6. **Consecutive-loss cooldown.** Track consecutive stops-out per market and enforce a cooling
   period before allowing new entries on the same market.
7. **Funding guard.** Block long entries when funding is above a configured threshold (longs
   paying excessively) and short entries when funding is below the inverse threshold.
8. **Rate-limit headroom guard.** Check WS/REST budget before submitting new actions.
9. **Reorder `evaluatePlaceOrder` guards** for efficiency: stale-state → open-order-limit →
   position-limit → max-notional → slippage → stop-sizing.
10. **Add `fills` table.** A dedicated fills table is needed for drawdown computation.

### P2 — Phase 5 prerequisites

11. **Build the candle recorder** (`src/marketdata/candle-store.ts`). Required before any
    indicator computation.
12. **Schema migration system.** Phase 5 will add more tables; migrations are essential now.
13. **Define `src/strategies/interfaces.ts`** and `src/intents/intents.ts`.
14. **Implement `trend-pullback-v1`** using the indicator set specified in AGENTS.md.
15. **Add batch cancel/modify to `ExecutionEngine`.** Required for strategy shutdown.
16. **Replace `ExecutionGate` testnet hardcode** with `config.allowMainnetWrites` flag.

### P3 — Phase 6 / operational hardening

17. **Build `src/telegram/`** with allowlist auth, read-only status commands, and privileged
    flatten/pause/reconcile flows.
18. **Dead-man's switch auto-refresh service** that refreshes every N minutes during live operation.
19. **`src/services/metrics.ts`** — win rate, expectancy, fill count, error count, reconnect count.
20. **`src/cli/run-paper.ts`** — paper trading mode.
21. **Systemd `.service` file** in `scripts/` for Ubuntu VPS deployment.
22. **WS silence watchdog** — degrade trust state if no fills/updates arrive for N minutes.

---

## 13. What Continues to Impress

The same structural strengths from v1 remain intact, and Phase 4 adds more:

- **Guard composability** — each risk guard is a pure function returning a typed result struct.
  Adding the drawdown guard will be ~30 lines following the exact same pattern, with no changes
  to existing guards or the engine orchestration.
- **Stop-based sizing with deterministic cap mode** — the `evaluateStopBasedSizing` implementation
  is clean and correct. Size is derived entirely from stop distance and account value fraction,
  using BigInt arithmetic throughout. No floating-point anywhere in the critical path.
- **Risk decisions are fully replayable** — every guard outcome, the approved/adjusted/rejected
  order details, active order counts, and trust state are persisted together in one record. A
  future postmortem or parameter tuning session can reconstruct exactly why every trade was
  approved, adjusted, or blocked.
- **Reduce-only orders are intelligently handled** — `evaluateOpenOrderLimit`,
  `evaluateConcurrentPositionLimit`, and `evaluateMaxOrderNotional` all skip for `reduceOnly`
  orders. This is exactly right: you never want the risk engine to block a TP/SL order because
  you've hit your open-order limit.

---

*This audit was generated by Antigravity on 2026-04-13. v2 reflects Phase 4 risk engine implementation and resolution of Phase 3 defects identified in v1. Update after each completed phase.*
