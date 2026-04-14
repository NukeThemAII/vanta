# AUDIT.md — Vanta-HL Industry Standards Audit

**Audited:** 2026-04-14 (v3 — updated post Phase 4 completion)
**Auditor:** Antigravity (AI Engineering Partner)
**Scope:** Full repository audit against industry standards for production-grade algorithmic trading systems.
**Phases completed (per LOG.md):** Phase 1 (Foundation), Phase 2 (Exchange State & Recovery), Phase 3 (Write-Side Execution) + post-audit hardening, Phase 4 (Risk Engine — fully complete)
**Phases outstanding:** Phase 5 (Strategy Runtime), Phase 6 (Telegram), Phase 7 (Hardening)

---

## Changelog vs. v2 Audit

| Finding | Status |
|---|---|
| RISK-2 · No drawdown stops | ✅ **Fixed** — daily + weekly realized drawdown guards implemented via `fill_records` |
| RISK-3 · No consecutive-loss cooldown | ✅ **Fixed** — per-market consecutive-loss streak with configurable cooldown window |
| RISK-4 · No funding guard | ✅ **Fixed** — directional funding rate guard blocks hostile entry |
| RISK-1 · Guard ordering suboptimal | ✅ **Fixed** — cheap guards run before expensive stop-sizing logic |
| RISK-5 · `resolveReferencePrice` silent fallback | ✅ **Fixed** — now logs warning when falling back from mid to mark/oracle |
| DB-4 · No fills table | ✅ **Fixed** — `fill_records` with upsert, PnL summation, and consecutive-loss queries |
| DB-4 (v2) · No `risk_event_records` index | ✅ **Fixed** — 3 indexes added: `occurred_at`, `operator+occurred_at`, `market_symbol+occurred_at` |
| TS-5 · "Phase 4" in leverage guard message | ✅ **Fixed** — replaced with policy language |
| EX-4 · No rate-limit headroom guard | ✅ **Fixed** — rate-limit surplus guard implemented |
| RC-2 · No watchdog for WS silence | ✅ **Fixed** — `MarketDataHealthMonitor` + `UserStateHealthMonitor` with auto-degradation |
| DB-2 · `market_events` unbounded growth | ✅ **Fixed** — `RetentionService` + `RetentionRepository` with configurable TTL |
| OPS-5 · No data retention policy | ✅ **Fixed** — `pnpm retention:run` with preview/apply/vacuum |
| EX-1 · `ExecutionGate` testnet hardcode | ⚠️ Partially addressed — degraded-trust emergency actions now allowed, but testnet-only hardcode remains |
| TS-3 · No migration system | ❌ Still open |
| OPS-1 · No systemd unit file | ❌ Still open |
| OPS-4 · No paper-trading mode | ❌ Still open |
| EX-2 · No batch cancel / batch modify | ❌ Still open |
| EX-3 · No dead-man's switch auto-refresh | ❌ Still open |
| TEST-3 · Write smoke test never run with real credentials | ❌ **Still the single biggest open item** |
| G-1 · No strategy module | ❌ Phase 5 scope |
| G-6 · No candle recorder | ❌ Phase 5 blocker |

---

## Executive Summary

Phase 4 is now functionally complete. The risk engine has grown from 4 guards (v2) to **9 guards**,
backed by a dedicated fill ledger, temporal drawdown/cooldown controls, market-data and
user-state health monitors, a retention subsystem, and a tiered degraded-trust execution policy.

The bot now has every mandatory risk guard specified in AGENTS.md except for a higher-level
"strategy-level disable switch" (which requires strategies to exist). The architecture is
production-grade in its risk controls: every trade proposal must pass through stale-state,
rate-limit, open-order, position-limit, drawdown, cooldown, funding, market-data freshness,
notional, slippage, and stop-sizing checks — all persisted, all configurable, all pure functions.

The single most impactful remaining gap is that **no funded testnet write-side smoke test has
ever been executed**. The execution spine, risk gating, and fill persistence have been
validated via unit tests and offline reconciliation runs, but the complete
`place → ack → fill → cancel` lifecycle has never been exercised end-to-end with real capital.
This was explicitly called out in v1 and v2, remains true in v3, and is the P0 item for Phase 5.

**Overall grade: A (production-grade risk layer complete; one critical smoke test gap, Phase 5
scope begins)**

---

## 1. Architecture & Module Design

### ✅ Strengths (updated)

| Area | Assessment |
|---|---|
| Risk guard composability | 9 pure-function guards, each in its own file. Adding a new guard is mechanical. Zero coupling between guards. |
| Temporal risk controls | Drawdown + cooldown use persisted fill history, not in-memory counters. Fully restart-safe. |
| Health monitoring architecture | `MarketDataHealthMonitor` and `UserStateHealthMonitor` are observer-pattern objects updated by WS managers and consumed by `FoundationService` for trust degradation + by `RiskEngine` for order gating. Clean separation. |
| Retention as config-driven policy | 13 tables covered by `RetentionRepository` definitions. Configurable per-tier TTL via env vars. Preview-before-apply pattern prevents accidental data loss. |
| Degraded-trust execution policy | `ExecutionGate` now has a three-tier model: `trusted` = all writes, `degraded` = emergency cancel/schedule_cancel only, `untrusted` = no writes. Exported as a testable function. |
| Fill normalization | `normalizeUserFills()` in `portfolio/fills.ts` provides a single canonical mapping from both REST reconciliation and live WS `userFills` events into `FillRecord`. No drift between the two ingestion paths. |
| Auto-recovery | `FoundationService` auto-recovers trust when market-data health or user-state sync returns to healthy after being degraded. Not just degrade-only. |

### ⚠️ Remaining Gaps

**G-1 — No strategy module (Phase 5)**
`src/strategies/` still missing. This is the next major body of work.

**G-3 — No intent translation layer (Phase 5)**
`src/intents/` still does not exist. The risk engine currently accepts `FormattedOrderRequest`,
coupling it to execution format. Must be addressed when strategies emit intents.

**G-4 — Container is growing**
`container.ts` now wires ~25 objects. Consider layering before Phase 5 adds strategy runtime,
candle store, and indicator services.

**G-5 — No market-to-strategy config**
`src/config/strategy-maps.ts` still absent. Phase 5 blocker.

**G-6 — No candle recorder (hard requirement, Phase 5 blocker)**
No structured candle store. Strategies cannot compute indicators without it.

---

## 2. TypeScript & Code Quality

### ✅ Strengths (unchanged)

Maximum-strictness TypeScript. Readonly-first. BigInt decimals throughout risk math. ESLint wired.

### ⚠️ Issues (updated)

**TS-1 — `asJsonValue()` escape hatch (unchanged)**
Still present. Acceptable for now but makes database forensics harder over time.

**TS-2 — Fixed ✅** (`-1` fallback removed in v2)

**TS-3 — Schema tables still have no migration system**
`schema.ts` now has **~19 `CREATE TABLE IF NOT EXISTS`** statements and **~20 `CREATE INDEX`**
statements. The debt is growing with each phase. A versioned migration system is urgently
needed before Phase 5 adds more tables.

**TS-4 — No lint / typecheck in CI or pre-commit (unchanged)**

**TS-5 — Fixed ✅** (leverage guard message corrected)

**TS-6 — `risk-engine.ts` line 487 has inconsistent indentation**
```typescript
      this.options.logger.debug(logPayload, message);
```
This line has extra leading whitespace compared to the surrounding code block (6 spaces instead
of 4). Minor but visible in the diff.

---

## 3. Persistence & Database

### ✅ Strengths (updated)

| Area | Assessment |
|---|---|
| `fill_records` table | Well-designed with composite `fill_key` (operator:tid) for upsert idempotency. Rich schema covering side, price, size, start_position, direction, closedPnl, fee, builderFee, crossed, isSnapshot. |
| Fill indexes | 3 indexes: `(operator_address, exchange_timestamp_ms DESC)`, `(market_symbol, exchange_timestamp_ms DESC)`, `(order_id)`. Covers all query patterns. |
| Risk event indexes | 3 indexes added since v2: `occurred_at DESC`, `(operator_address, occurred_at DESC)`, `(market_symbol, occurred_at DESC)`. |
| Retention definitions | 13 tables covered: `market_events`, `app_events`, `app_boots`, `asset_registry_snapshots`, `account_snapshots`, `open_order_snapshot_runs`, `reconciliation_runs`, `user_event_records`, `runtime_state_transitions`, `fill_records`, `execution_actions`, `risk_event_records`, `order_state_transitions`. |
| WAL checkpoint + VACUUM | `RetentionRepository` exposes `checkpointWal()` and `vacuum()` for post-cleanup compaction. |

### ⚠️ Issues (updated)

**DB-1 — No migration versioning (unchanged, critical)**
Now 19 tables + 20 indexes in `CREATE IF NOT EXISTS` mode. This is the highest-priority
technical debt item.

**DB-2 — Fixed ✅** Retention service exists with configurable TTL.

**DB-3 — Retention does not cover `order_state_records` or `cloid_mappings`**
LOG.md acknowledges this is deliberate because those semantics need more care. But once live
order volume accumulates over months, these tables will also grow unbounded. Need a policy
decision before mainnet.

**DB-4 — `FillRepository.sumClosedPnlSince` does a full scan of matching rows**
```typescript
const rows = this.listClosedPnlSinceStatement.all(operatorAddress, startTimeMs);
return rows.reduce((sum, row) => addDecimalStrings(sum, normalizeDecimalString(row.closed_pnl)), "0");
```
This fetches all qualifying rows into memory and sums in JS. For a bot with thousands of fills
per week, this could become slow. A `SUM()` aggregate in SQL would be more efficient, but since
the decimal arithmetic is BigInt-based and SQLite `SUM()` uses floating-point, the current
in-memory approach is actually correct for precision. Document this as a deliberate trade-off.

**DB-5 — `retention:run` is a manual CLI, not an automated cron**
The retention CLI (`pnpm retention:run`) must be invoked manually. There is no automated
scheduling. For a production VPS, this should either be a cron job or run automatically on
startup/shutdown.

---

## 4. Exchange Integration

### ✅ Improvements since v2

- Rate-limit headroom guard now uses per-snapshot `requestsSurplus` from the account mirror.
- `UserStateWsManager` now persists fills from live WS events into `fill_records`.

### ⚠️ Remaining Issues

**EX-1 — `ExecutionGate` testnet hardcode (partially addressed)**
Degraded-trust emergency actions (cancel, schedule_cancel) are now allowed under `degraded` trust.
But the `"Phase 3 write actions are restricted to testnet"` throw at line 33 remains hardcoded.
Must become `config.allowMainnetWrites` before mainnet.

**EX-2 — No batch cancel / batch modify (unchanged)**
Still single-order only. Critical for risk emergency stops and strategy shutdown.

**EX-3 — No dead-man's switch auto-refresh (unchanged)**
Primitive exists, no service refreshes it periodically.

**EX-5 — `requirePerpAsset` still has "Phase 4" in message**
```typescript
`Phase 4 risk engine supports perps only; asset ${assetId} is unavailable or not a perp`
```
This was not caught in the leverage guard fix. Should use policy language.

---

## 5. Risk Engine (updated)

### ✅ Complete Guard Suite

| Guard | File | Coverage | Correctness |
|---|---|---|---|
| `evaluateFreshAccountState` | `stale-state.ts` | Rejects if snapshot undefined or stale | ✅ |
| `evaluateRateLimitHeadroom` | `rate-limit.ts` | Rejects if surplus < min threshold | ✅ |
| `evaluateOpenOrderLimit` | `exposure.ts` | Rejects if active orders ≥ max | ✅ |
| `evaluateConcurrentPositionLimit` | `exposure.ts` | Rejects if positions ≥ max for new exposure | ✅ |
| `evaluateRealizedDrawdown` | `drawdown.ts` | Rejects if daily/weekly realized PnL < floor | ✅ |
| `evaluateConsecutiveLossCooldown` | `cooldown.ts` | Rejects during cooldown window after N losses | ✅ |
| `evaluateFundingRate` | `funding.ts` | Rejects longs when funding too positive, shorts when too negative | ✅ |
| `evaluateMarketDataFreshness` | `market-data.ts` | Rejects if mid/trade data is missing or stale | ✅ |
| `evaluateMaxOrderNotional` | `exposure.ts` | Rejects if price×size > maxUsd | ✅ |
| `evaluatePriceDeviation` | `slippage.ts` | Rejects aggressive prices > maxBps from reference | ✅ |
| `evaluateStopBasedSizing` | `exposure.ts` | Rejects or caps size to risk budget from stop distance | ✅ |
| `evaluateLeverageLimit` | `leverage.ts` | Rejects if leverage > capped exchange max | ✅ |

### ⚠️ Remaining Risk Issues

**RISK-7 — `evaluateRealizedDrawdown` uses calendar boundaries, not rolling windows**
`startOfUtcDayMs()` and `startOfUtcWeekMs()` compute UTC midnight / UTC Monday midnight. This
means the drawdown counter resets at midnight UTC regardless of recent loss timing. A trader
who loses $49 at 23:59 UTC and $49 at 00:01 UTC would pass both checks despite losing $98 in
two minutes. Consider adding a rolling 24h/168h option alongside the calendar-based check.

**RISK-8 — Consecutive-loss cooldown is per-market, but drawdown stop is global**
The `evaluateConsecutiveLossCooldown` queries fills for a specific `marketSymbol`, but
`evaluateRealizedDrawdown` sums across all markets. This is probably correct (you want to stop
trading everywhere if total PnL is bad, but cool down only the specific market with a losing
streak), but the asymmetry should be documented as an explicit design decision.

**RISK-9 — No "strategy-level disable switch"**
AGENTS.md requires: "strategy-level disable switch after repeated failure." Since strategies
don't exist yet, this guard can't be implemented. Should be in Phase 5 scope.

**RISK-10 — `evaluateModifyOrder` does not run drawdown/cooldown/funding guards**
`evaluateModifyOrder` only checks: stale-state, asset resolution, market-data freshness,
max-notional, and slippage. It does not check drawdown, cooldown, or funding. This is arguably
correct — modifying an existing order is not new exposure — but if a modify changes side or
significantly increases size, it could bypass temporal protections. Consider whether
size-increasing modifies should be subject to the same temporal guards as new placements.

---

## 6. Health Monitoring (New Section)

### ✅ What's well-implemented

**Market-data health:**
- `MarketDataHealthMonitor` records latest mid/trade timestamps per watched market.
- `FoundationService` evaluates freshness every 10 seconds.
- Trust degrades to `degraded` when any watched market has stale/missing mid or trade data.
- Trust auto-recovers when market-data health returns to `healthy` and the degradation was
  market-data-specific (checked via `trust.reason.startsWith("market_data_")`).

**User-state health:**
- `UserStateHealthMonitor` models sync cycles for required private channels
  (`clearinghouseState`, `spotState`, `openOrders`).
- Sync cycle begins on bootstrap and on transport close/reconnect.
- If required snapshots don't arrive before deadline, trust degrades to `degraded`.
- Design correctly avoids false alarms during legitimate quiet periods (event-driven streams).

### ⚠️ Health Monitoring Issues

**HEALTH-1 — Trust recovery race between market-data and user-state**
Both `handleRecoveredMarketDataHealth` and `handleRecoveredUserStateHealth` independently try
to transition trust back to `trusted` when their respective health recovers. If both are
degraded simultaneously but only one recovers, trust could be restored prematurely.

The code checks `trust.reason.startsWith("market_data_")` / `trust.reason.startsWith("user_state_")`
before recovering, which prevents the wrong monitor from recovering the wrong degradation.
But if the trust was degraded by market data and then user state also degrades (writing a new
reason starting with `"user_state_"`), market-data recovery would see the current reason
starts with `"user_state_"` and would not attempt recovery — correct behavior. However, when
user-state then recovers, it would try to restore trust without knowing market-data is
also degraded. The `marketDataDegraded` flag mitigates this in the heartbeat flow, but the
trust state machine itself doesn't enforce multi-source degradation tracking.

This is a subtle correctness concern under compound degradation. A more robust model would
track degradation reasons as a set, not a single latest reason, and only recover when all
reasons in the set are resolved.

**HEALTH-2 — Health thresholds are in the `RiskConfig`, not a separate health config**
`marketDataMaxMidAgeMs`, `marketDataMaxTradeAgeMs`, and `userStateMaxSyncWaitMs` are in
`RiskConfig` even though they're consumed by `FoundationService` for health monitoring
independently of the risk engine. This conflates runtime health policy with trade risk policy.
Not a bug, but makes the config tree harder to reason about as it grows.

---

## 7. Retention Subsystem (New Section)

### ✅ What's well-implemented

- Config-driven: `marketEventsDays: 7`, `runtimeStateDays: 30`, `executionAuditDays: 90`.
- Preview mode by default — `pnpm retention:run` shows what would be deleted without deleting.
- Apply mode with `--apply` flag. Optional `--vacuum` for post-cleanup compaction.
- `RetentionRepository` uses prepared statements per target for both count and delete.
- All deletes run in a single transaction for atomicity.
- `checkpointWal()` followed by `VACUUM` ensures disk space is actually reclaimed.

### ⚠️ Retention Issues

**RET-1 — `retention:run` is manual, not automated**
No cron, no startup hook, no systemd timer. Must be scheduled by the operator. For a production
VPS, this should be either a post-boot hook or a cron job documented in the deployment guide.

**RET-2 — Retention cutoff uses wall-clock ISO timestamps, not exchange timestamps**
`cutoffIsoForDays` computes `now - days` as an ISO string and compares against each table's
`received_at` / `created_at` / `occurred_at` column. This is correct for most tables, but
`fill_records` uses `recorded_at` for retention cutoff while the primary ordering key is
`exchange_timestamp_ms`. This could cause a small drift between what the drawdown guard sees
(exchange-time) and what retention deletes (recorded-time). In practice the difference is
negligible (ms-level), but it's worth noting.

---

## 8. Reconciliation & State Recovery

### ✅ Improvements since v2

- RC-2 fixed: **Two independent health monitors** now watch market-data and user-state health
  and automatically degrade trust when freshness is lost.
- Reconciliation now fetches recent user fills via `userFillsByTime()` and persists them locally,
  so realized PnL and cooldown logic survive restarts.
- Live `userFills` WS events also persist into `fill_records` through `UserStateWsManager`.

### ⚠️ Remaining Issues

**RC-4 — Compound degradation model is single-reason (see HEALTH-1)**
The trust state machine stores a single reason string. With market-data and user-state monitors
both able to degrade trust, the system can lose track of concurrent degradation causes.

---

## 9. Security (unchanged from v1/v2)

All previously noted strengths remain. All previously noted risks remain open:
- SEC-1: Private key in heap for full process lifetime — acceptable for MVP VPS.
- SEC-2: Telegram auth not yet built — Phase 6 requirement.
- SEC-3: SQLite plaintext — `data/` needs `chmod 700`.
- SEC-4: No secrets scanning in CI.

---

## 10. Testing

### ✅ Improvements since v2

| Addition | Quality |
|---|---|
| `risk-engine.test.ts` — expanded from 6 to 12 test scenarios | Now covers drawdown rejection, consecutive-loss cooldown, funding rejection, rate-limit surplus, market-data freshness, and reduce-only happy-path approval. Excellent. |
| `fill-repository.test.ts` | 95 lines covering upsert, PnL summation, and consecutive-loss streak queries with real SQLite. |
| `user-event-repository.test.ts` | Covers latest event time queries per channel. |
| `user-state-health.test.ts` | Covers sync cycle, awaiting, and timed-out degradation states. |
| `marketdata/health.test.ts` | Covers healthy, stale, and missing channel states. |
| `retention-service.test.ts` | 158 lines covering preview, apply, and vacuum flows with real SQLite. |
| `execution-gate.test.ts` — expanded | Covers degraded-trust emergency actions (cancel allowed, place blocked). |

### ⚠️ Issues (updated)

**TEST-1 — No integration tests (unchanged)**
Still no tests that exercise the full boot → reconcile → WS subscribe → order lifecycle.

**TEST-2 — No property-based tests for `decimal.ts` (unchanged)**

**TEST-3 — Write smoke test never run with real credentials (unchanged, P0)**
This is now the single biggest remaining verification gap for the entire Phase 1–4 stack.
Every risk guard, every fill persistence path, and every order-state transition has been
validated by unit tests, but the system has never executed a real `place → exchange_ack → fill` 
cycle with a funded testnet account.

**TEST-5 — No coverage threshold enforced (unchanged)**

---

## 11. Operational Readiness

### ✅ Improvements since v2

- `pnpm state:risk` now shows daily/weekly closed PnL, recent fills, market-data freshness,
  user-state sync status, execution policy, and recent risk decisions. This is a genuine
  operator dashboard in CLI form.
- `pnpm retention:run` with preview/apply/vacuum gives operators bounded data management.
- Degraded-trust execution policy means emergency cancel/schedule_cancel works even when
  the bot's data path is unhealthy.

### ⚠️ Remaining Issues

**OPS-1 — No systemd unit file (unchanged)**

**OPS-2 — No Telegram bot (Phase 6 gap, unchanged)**

**OPS-3 — No metrics collection (unchanged)**
`src/services/metrics.ts` still absent.

**OPS-4 — No paper-trading mode (unchanged)**

**OPS-5 — Fixed ✅** Retention service exists.

**OPS-6 — Risk rejections logged but no operator push alert (unchanged)**
`RiskEngine.reject()` logs at `warn` level and persists, but there is no active push
notification. In production, silent rejections during a strategy's intended entry window
must be surfaced to the operator immediately.

**OPS-7 — No dedicated emergency CLI**
The execution gate now supports emergency cancel under degraded trust, but there is no
operator-facing `pnpm emergency:cancel-all` or `pnpm emergency:flatten` CLI. The policy exists
in code but the tooling to invoke it does not.

---

## 12. Adherence to AGENTS.md (updated)

| Requirement | Status |
|---|---|
| Testnet first | ✅ Enforced by `ExecutionGate` hardcode |
| Perps first | ✅ |
| nktkas SDK integration | ✅ |
| No AI in live path | ✅ |
| Strategy plugin contract | ❌ Phase 5 |
| Risk engine is final authority | ✅ **Complete** — 12 guards covering all AGENTS.md requirements |
| One responsibility per module | ✅ |
| No hidden mutable state | ✅ Fills, risk events, health state all persisted |
| LOG.md maintained | ✅ 5 consecutive sessions documented |
| Strict typing | ✅ |
| Operational safety first | ✅ Full trust gating, health monitoring, retention |
| `cloid` contract | ✅ |
| Dead-man's switch | ⚠️ Primitive exists, no auto-refresh |
| Candle history (hard requirement) | ❌ Phase 5 blocker |
| systemd deployment | ❌ |
| Strategy → intent pipeline | ❌ Phase 5 |
| Batch cancel/modify | ❌ |
| Drawdown / cooldown guards | ✅ **Complete** |
| Funding guard | ✅ **Complete** |
| Rate-limit headroom | ✅ **Complete** |
| Market-data freshness guard | ✅ **Complete** |
| Degraded-trust emergency policy | ✅ **Complete** |
| Data retention | ✅ **Complete** |

---

## 13. Prioritized Recommendations (updated)

### P0 — Must do before Phase 5 strategy work

1. **Run the full write smoke test with a real funded testnet account.** This has been the P0
   item in every audit version. Place an order, let it ack, modify it, cancel it, check a fill.
   Inspect `execution_actions`, `risk_event_records`, `fill_records`, `cloid_mappings`, and
   `order_state_transitions` in SQLite. Until this is done, the Phase 1–4 stack is unvalidated.
2. **Schema migration system.** 19 tables + 20 indexes with `CREATE IF NOT EXISTS` is
   unsustainable. Even a simple `schema_version` table with sequential migration scripts would
   suffice. Phase 5 will add more tables (candle store, strategy state, intent records). 
3. **Fix "Phase 4" in `requirePerpAsset` message.** Replace with policy language like the
   leverage guard fix.

### P1 — Phase 5 prerequisites

4. **Build the candle recorder** (`src/marketdata/candle-store.ts`). This is the hard
   architectural requirement blocking all indicator computation.
5. **Define `src/strategies/interfaces.ts`** — the typed strategy plugin contract.
6. **Define `src/intents/intents.ts`** — the canonical intent union type.
7. **Build `src/config/strategy-maps.ts`** — market-to-strategy assignment.
8. **Implement `trend-pullback-v1`** as the first strategy.
9. **Add batch cancel/modify to `ExecutionEngine`.** Required for strategy shutdown and risk
   emergency stops.
10. **Replace `ExecutionGate` testnet hardcode** with `config.allowMainnetWrites` flag.

### P2 — Phase 6 / operational hardening

11. **Build `src/telegram/`** with allowlist auth, status commands, and privileged controls.
12. **Dead-man's switch auto-refresh service.**
13. **`src/services/metrics.ts`** — win rate, expectancy, fill count, error count.
14. **`src/cli/run-paper.ts`** — paper trading mode.
15. **systemd `.service` file** and Ubuntu VPS deployment guide.
16. **Emergency operator CLI** (`emergency:cancel-all`, `emergency:flatten`).
17. **Schedule retention as cron job** or startup hook for automated cleanup.
18. **Consider compound trust degradation model** — track degradation reasons as a set instead
    of latest single reason.

---

## 14. What Continues to Impress

Phase 4 was executed with exceptional discipline across 4 consecutive agent sessions:

- **Fill ledger as a single source of truth for temporal risk.** The `FillRepository` with
  `sumClosedPnlSince` and `getConsecutiveLossStreak` means drawdown and cooldown guards are
  restart-safe by design. No in-memory-only counters that reset on crash.

- **`evaluateConsecutiveLossCooldown` with time-windowed expiry.** The guard doesn't just
  count losses — it checks whether the cooldown window has expired since the last loss timestamp.
  A bot that loses 3x but then waits an hour will be allowed to trade again. This prevents
  permanent lockout while still enforcing the cooling period.

- **`evaluateFundingRate` with directional asymmetry.** Longs are blocked when funding is
  positive above threshold (longs paying), shorts when negative below threshold (shorts paying).
  This is exactly right; many bots get this backwards.

- **Retention with preview-before-apply.** The `preview()` method counts rows that would be
  deleted without deleting them. The operator can see `totalMatchedRows: 42,000` before
  committing to `--apply`. This is production-quality operator tooling.

- **Health monitoring that understands Hyperliquid's event model.** The user-state watchdog
  validates sync completion after startup/reconnect rather than assuming continuous events.
  The LOG.md entry explains why: "Hyperliquid user subscriptions are snapshot-on-subscribe and
  otherwise event-driven. A quiet account can legitimately have no ongoing private events."
  This is a nuanced understanding of the exchange that most bot implementations get wrong.

- **The risk engine test suite now has 12 scenarios** covering stale state, market-data
  degradation, stop-based sizing, notional rejection, open-order limits, price deviation,
  leverage caps, drawdown, cooldown, funding, rate-limit, and reduce-only approval. The test
  fixture uses real SQLite in-memory databases and real `FillRepository` writes. This is the
  kind of test infrastructure that prevents regressions.

---

*This audit was generated by Antigravity on 2026-04-14. v3 reflects full Phase 4 completion
including temporal risk controls, health monitoring, retention, and degraded-trust execution
policy. Update after each completed phase.*
