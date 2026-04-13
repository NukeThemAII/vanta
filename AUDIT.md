# AUDIT.md — Vanta-HL Industry Standards Audit

**Audited:** 2026-04-13  
**Auditor:** Antigravity (AI Engineering Partner)  
**Scope:** Full repository audit against industry standards for production-grade algorithmic trading systems.  
**Phases completed (per LOG.md):** Phase 1 (Foundation), Phase 2 (Exchange State & Recovery), Phase 3 (Write-Side Execution)  
**Phases outstanding:** Phase 4 (Risk Engine), Phase 5 (Strategy Runtime), Phase 6 (Telegram), Phase 7 (Hardening)

---

## Executive Summary

Vanta is significantly better than most open-source or hobbyist trading bots at this stage of
development. The foundation is built with deliberate engineering discipline: strict TypeScript,
clean module boundaries, event-sourced order state, deterministic reconciliation, and a
trust-gating pattern that prevents rogue writes. The three completed phases deliver a
production-quality skeleton that a serious operator can build on.

However, the bot is not ready for production. Several Phase 4–7 components that block live
trading (risk engine, candle recorder, strategy runtime, Telegram control plane) are completely
absent. There are also a handful of specific code-level issues in the existing phases that should
be addressed before Phase 4 work begins.

**Overall grade: B+ (foundations excellent, blocking gaps remain)**

---

## 1. Architecture & Module Design

### ✅ Strengths

| Area | Assessment |
|---|---|
| Module separation | Outstanding. Each concern lives in exactly one module. No class mixes market data ingestion, signal generation, order formatting, and persistence. |
| Dependency injection | `container.ts` wires the entire system manually without a DI framework. This is explicit, readable, and easy to trace. No magic. |
| Intent pipeline stub | The foundation correctly anticipates the `strategy → intent → risk → execution` flow even though strategies don't exist yet. The execution types (`PlaceOrderRequest`, `CancelOrderRequest`, …) are already expressed at intent level, not raw SDK level. |
| Trust gating | `ExecutionGate` is a clean chokepoint. Every write primitive calls `requireWriteAccess()` first. Violations throw before the nonce controller fires. |
| Event-sourced order state | `OrderStateMachine` + `OrderStateRepository` + `order_state_transitions` table is a genuine event-sourcing pattern — every lifecycle move is persisted as a transition record with a source label. This is industry standard for exchange-facing systems. |
| Asset ID centralization | `AssetRegistry` is the single source of truth for asset IDs. No strategy or order path can hardcode an asset ID. |
| Reconciliation-first startup | Boot reconciliation is wired before any trading logic is allowed to run. `RuntimeTrustState` gates everything else. |

### ⚠️ Gaps & Issues

**G-1 — No strategy module exists (Phase 5 gap)**  
`src/strategies/` is missing entirely. The AGENTS.md contract is clear: every strategy must
implement a typed plugin interface, must not call exchange directly, and must emit intents.
Until this exists, the bot cannot trade.

**G-2 — No risk engine (Phase 4 gap)**  
`src/risk/` is completely absent. The execution engine currently accepts any correctly-typed
`PlaceOrderRequest` without checking position size, exposure limits, daily drawdown, funding
conditions, or cooldown. This is the most critical architectural gap before mainnet.

**G-3 — No intent translation layer**  
`src/intents/` is defined in AGENTS.md but does not exist. Strategy intents (`ENTER_LONG`,
`ADD_REDUCE_ONLY_SL`, etc.) need a typed translator layer between strategy outputs and
`ExecutionEngine` primitives. Currently there is no interface contract for this.

**G-4 — `FoundationContainer` holds too much**  
The container interface mixes infrastructure (database, logger) with operational services
(executionEngine, foundationService). As Phase 4–6 modules are added this will become unwieldy.
Consider splitting into layered sub-containers: `InfraContainer`, `ExchangeContainer`,
`TradingContainer`.

**G-5 — No market-to-strategy config layer**  
`src/config/strategy-maps.ts` from AGENTS.md does not exist. Without it, the runtime cannot know
which strategy drives which market.

**G-6 — No candle/book/trade recorder (architectural requirement)**  
AGENTS.md explicitly states this is a "hard architectural requirement". `src/marketdata/` contains
only `ws-manager.ts` and `normalizers.ts`. There is no `candle-store.ts`, `book-store.ts`, or
`trade-store.ts`. Market data is received over WebSocket and persisted as raw `market_events`
JSON, but it is not stored in a structured replay-capable format. This blocks backtesting and
offline indicator computation entirely.

---

## 2. TypeScript & Code Quality

### ✅ Strengths

| Area | Assessment |
|---|---|
| `tsconfig.json` strictness | Near-maximum: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`. This is the gold standard for Node.js TypeScript. |
| No `any` in critical paths | The `asJsonValue()` escape hatch in `core/types.ts` is the only significant `as` cast and it is clearly isolated and named. |
| Readonly-first design | All types use `readonly` on arrays and fields throughout. Mutation is the exception, not the rule. |
| BigInt decimal arithmetic | `core/decimal.ts` is a clean BigInt-based decimal library. This avoids floating-point rounding bugs in fill-size accumulation — a common failure point in trading bots. |
| ESLint wired | `eslint.config.mjs` with `typescript-eslint` is configured. |

### ⚠️ Issues

**TS-1 — `asJsonValue()` is an escape hatch, not a solution**  
`asJsonValue(value: unknown): JsonValue` casts `unknown` to `JsonValue` unsafely. It is used
extensively to persist arbitrary SDK response objects. Prefer explicit mapping functions that
validate the shape before persisting (or use `zod`). The current approach silently swallows
unexpected response structures into JSON blobs.

**TS-2 — `mapFormattedModifyToSdk` fallback is dangerous**

```typescript
oid: modify.target.clientOrderId ?? modify.target.orderId ?? -1
```

The `-1` fallback in `execution-engine.ts:587` is a hard-coded sentinel that would cause a
silent bad request to Hyperliquid. The formatter should `throw` if neither identifier is present,
not fall back to `-1`. The formatter already validates this at call sites but the mapping
function itself should not silently accept it.

**TS-3 — Schema tables have no migration system**  
`schema.ts` uses `CREATE TABLE IF NOT EXISTS` as the migration strategy. This works for initial
creates but cannot rename columns, add NOT NULL columns to existing tables, or remove indexes.
For a production bot that runs for months, a proper migration framework (e.g., `drizzle-orm`
with `migrate()` or a custom versioned migration runner) is essential. Without it, schema drift
between development and production is a bug waiting to happen.

**TS-4 — No lint / typecheck in CI or pre-commit**  
ESLint and `typecheck` are available as scripts but there is no `husky`, `lint-staged`, or CI
pipeline configuration. Code quality checks are optional and rely on developer discipline.

---

## 3. Persistence & Database

### ✅ Strengths

| Area | Assessment |
|---|---|
| WAL mode | SQLite in WAL mode is correct for a single-process, write-ahead-log workload. |
| Schema design | 16 well-named tables with appropriate foreign keys, cascade deletes, and a solid set of indexes. `order_state_transitions` as an append-only event log is excellent. |
| Repository pattern | Each table has its own repository class. Business logic never builds raw SQL. |
| Schema indexes | All hot query paths (`client_order_id`, `order_key`, `market_symbol + updated_at`, etc.) have explicit indexes. |

### ⚠️ Issues

**DB-1 — No migration versioning (see TS-3)**  
Critical. Already flagged above. Add a `schema_migrations` table and versioned migration scripts.

**DB-2 — `market_events` will become a liability**  
All WebSocket market events (mids, trades) are persisted as raw JSON in `market_events`. There
is no TTL, no retention policy, and no structured candle/book schema. Over a few days of
continuous operation this table will grow into tens of millions of rows. A structured
`candle_records` / `book_snapshots` / `trade_records` schema with a 7-day retention cron is
needed before any live run.

**DB-3 — No query for active/non-terminal order states**  
`OrderStateRepository` does not appear to expose a `listActiveOrders()` query returning all
non-terminal states across markets. This query is essential for the risk engine (how many open
positions/orders exist currently?) and for a `/positions` Telegram command.

**DB-4 — No dedicated fills table**  
Individual fills are tracked through `order_state_transitions` with `source = "user_fill"`, but
there is no dedicated `fills` table with one row per fill, fill price, fill size, fee, and side.
This makes PnL computation, slippage analysis, and daily reports much harder to implement
correctly.

---

## 4. Exchange Integration

### ✅ Strengths

| Area | Assessment |
|---|---|
| nktkas SDK | Correct choice. No hand-rolled signing. |
| Cloid contract | `CloidService` centralizes 16-byte hex cloid generation. No strategy or order path can produce invalid cloids. |
| Nonce isolation | `ExecutionNonceController` with `AsyncLocalStorage` is a clean single-writer pattern. Nonce issuance is not scattered. |
| Order formatter | `HyperliquidOrderFormatter` is the only place that touches size/price precision via SDK `formatPrice`/`formatSize`. Correct. |
| Dead-man's switch | `scheduleCancel` is wired as an execution primitive. |
| Reconnect via reconciliation | WS reconnect paths go through reconciliation before resuming activity. |

### ⚠️ Issues

**EX-1 — `ExecutionGate` is testnet-locked by hardcode**

```typescript
if (identity.network !== "testnet") {
  throw new ExecutionGateError("Phase 3 write actions are restricted to testnet...");
}
```

This is appropriate for Phase 3 but must be replaced before mainnet use. Use a capability flag
(e.g., `config.allowMainnetWrites`) that is explicitly opt-in and validated at startup,
not a hardcoded network throw.

**EX-2 — No batch cancel / batch modify primitives**  
AGENTS.md requires "batch modify orders" and "cancel order(s)" (plural). The current
`ExecutionEngine` only has single-order cancel and single-order modify. Batch operations are
needed for strategy shutdown, risk emergency stops, and reconciliation cleanup.

**EX-3 — Dead-man's switch is not auto-refreshed**  
`scheduleCancel` exists as a primitive but there is no service that refreshes it on a timer
during live operation. Without a refresh loop, the dead-man's switch either never fires
(if never set) or fires once and is then exhausted (trigger-count limited).

**EX-4 — No WebSocket rate-limit headroom guard**  
Rate limiting on the Hyperliquid WebSocket is acknowledged in AGENTS.md but there is no
`RateLimitGuard` in the execution path. Under high-frequency strategy output, the bot could
saturate the WS message rate budget silently.

---

## 5. Reconciliation & State Recovery

### ✅ Strengths

| Area | Assessment |
|---|---|
| Trust state machine | Four-state model (`trusted`, `reconciling`, `degraded`, `untrusted`) is correct and enforced. |
| Startup reconciliation | Boot compares registry, positions, balances, and open orders before enabling writes. |
| Structural-only diff | The fix for warning spam (diffing structural fields only, not live prices) is pragmatic and correct. |
| Reconciliation event log | `reconciliation_runs` + `reconciliation_issues` tables give a full audit trail. |

### ⚠️ Issues

**RC-1 — Reconciliation does not compare `order_state_records` to `frontendOpenOrders`**  
`diffOpenOrderSnapshots` compares the _previous persisted snapshot_ to the _current exchange
snapshot_, but does not compare the local `order_state_records` table to the exchange's
authoritative view. After a crash where order state was partially written, this gap could leave
phantom orders in `order_state_records` that the exchange no longer knows about.

**RC-2 — No watchdog for WS silence during live trading**  
Once `trusted`, the runtime stays `trusted` until the next explicit reconciliation. If fills
stop arriving via WebSocket for an extended period during live trading, the bot does not
automatically degrade and pause. A silence watchdog that triggers reconciliation + degradation
is missing.

**RC-3 — Account position drift is warn-only**  
`diffAccountSnapshots` returns all position issues at `severity: "warn"`. An unexpected position
appearing or disappearing should arguably be `severity: "error"` and trigger `untrusted` state
immediately. Currently a surprise position change would only warn while leaving the bot trusted.

---

## 6. Security

### ✅ Strengths

| Area | Assessment |
|---|---|
| Private key handling | Key is held in `PrivateKeyAccount` from `viem`. Never appears in logs (verified by `signer-registry.ts`). |
| Zod env validation | Private key format validated at startup with a strict regex before being loaded into memory. |
| No credentials in database | No private key or API key is persisted to SQLite. |
| Vault mode support | `vaultAddress` supported in execution identity for future sub-account isolation. |

### ⚠️ Issues

**SEC-1 — Private key lives in heap for full process lifetime**  
Once `privateKeyToAccount()` is called, the `PrivateKeyAccount` object lives in the Node.js
heap indefinitely. A heap dump would expose it. For a properly firewalled VPS this is
acceptable risk for MVP but must be documented.

**SEC-2 — No Telegram auth yet (Phase 6 gap)**  
When the Telegram bot is built, the AGENTS.md allowlist requirement (specific Telegram user IDs
only) must be enforced from day one. Privileged commands (`/flatten_all`, `/pause`) must require
confirmation or privileged mode. Do not ship Telegram without auth.

**SEC-3 — SQLite file is plaintext**  
The `data/` directory must have strict OS-level permissions (`chmod 700`) on the VPS. For a
dedicated VPS this is acceptable but must be documented. Consider encrypting at rest if the VPS
is shared.

**SEC-4 — No secrets scanning**  
No `.gitleaks` or `detect-secrets` config. The `.gitignore` excludes `.env` but there is no
defense-in-depth layer if a private key is accidentally committed.

---

## 7. Testing

### ✅ Strengths

| Area | Assessment |
|---|---|
| Test framework | `vitest` is the correct modern choice. |
| Unit test modules covered | `cloid-service`, `execution-gate`, `order-formatter`, `order-state-machine`, `asset-registry`, `runtime-trust-controller`, `account-mirror`, `open-order-reconciliation`, env/network config. |
| Test fixtures | `tests/fixtures/hyperliquid-fixtures.ts` normalizes test data. |

### ⚠️ Issues

**TEST-1 — No integration tests**  
`tests/` has only a `unit/` subdirectory. No integration tests run against a real SQLite
database, mock exchange, or full reconciliation flow. The `integration/` directory mentioned in
AGENTS.md does not exist.

**TEST-2 — No property-based tests for `decimal.ts`**  
The BigInt decimal arithmetic library is central to fill accumulation and average fill price
computation. Edge cases (very small sizes, very large prices, zero divisor, negative numbers)
should be covered by property-based tests (e.g., `fast-check`).

**TEST-3 — Write-side smoke test never run with real credentials**  
LOG.md acknowledges that `smoke:execution --allow-write-actions` was never run with a real
funded testnet account. The complete `place → ack → fill/cancel` lifecycle has not been
exercised end-to-end. This is the single most important missing verification before Phase 4.

**TEST-4 — No coverage for `ExecutionEngine` error paths**  
`runAction` catch block, `markNeedsReconciliation`, and the `failed` action persistence path
are untested. These are the paths that fire when the exchange rejects an order or the network
fails mid-submission.

**TEST-5 — No coverage threshold enforced**  
No minimum coverage threshold is configured in `vitest.config.ts`. Coverage can silently
regress as the codebase grows.

---

## 8. Operational Readiness

### ✅ Strengths

| Area | Assessment |
|---|---|
| Structured logs | `pino` with component sub-loggers. Log calls include contextual fields (orderKey, marketSymbol, clientOrderId). |
| Graceful shutdown | `SIGINT`/`SIGTERM` handlers unsubscribe WS, close SQLite, record boot as `stopped`. |
| CLI tooling | `reconcile:run`, `state:account`, `state:orders`, `smoke:execution` are all wired and documented. |
| `.env.example` | Provided and reflects the full schema. |
| `LOG.md` maintenance | Updated after every phase. Excellent discipline. |

### ⚠️ Issues

**OPS-1 — No systemd unit file**  
AGENTS.md mandates systemd for process management on Ubuntu. No `.service` file exists. Without
it the bot cannot auto-restart after a VPS reboot or crash.

**OPS-2 — No Telegram bot (Phase 6 gap)**  
Emergency controls (`/flatten_all`, `/pause`, `/reconcile`) do not exist. Without them, operator
intervention requires direct VPS SSH access during a live incident.

**OPS-3 — No metrics collection**  
`src/services/metrics.ts` and `src/services/health.ts` are absent. There is no way to query
win rate, slippage, fill latency, API error counts, or reconnect counts at runtime.

**OPS-4 — No paper-trading / dry-run mode**  
`src/cli/run-paper.ts` does not exist. The bot will go straight from testnet to mainnet with
no intermediate simulated live run mode. Paper trading is a critical safety validation step.

**OPS-5 — No data retention policy**  
`market_events`, `user_event_records`, and `order_state_transitions` grow without bound. A
cron-based retention job is needed before any sustained run. Without it, the SQLite file will
grow to gigabytes and WAL checkpoint performance will degrade.

**OPS-6 — No alerting on execution errors**  
When `ExecutionEngine.runAction` catches an error it logs at `error` level but there is no hook
to alert the operator via Telegram or any other channel. Silent order failures are unacceptable
in production.

---

## 9. Dependency & Package Hygiene

| Package | Version | Assessment |
|---|---|---|
| `@nktkas/hyperliquid` | `^0.32.2` | Correct SDK choice. Pin to exact version before mainnet. |
| `better-sqlite3` | `^12.8.0` | Good. WAL mode. |
| `pino` | `^10.3.1` | Good. |
| `viem` | `^2.39.0` | Good. Used only for wallet and type aliases. |
| `zod` | `^4.3.6` | Good. Used for env validation. |
| `grammy` | — | **Missing.** Required for Telegram (Phase 6). |
| `fast-check` | — | Not present. Recommended for decimal property tests. |
| `drizzle-orm` or similar | — | Not present. Recommended for schema migrations. |

**DEP-1 — No lockfile pinning for SDK minor version**  
`^0.32.2` allows minor updates. A new minor SDK version could change wire format, response
shapes, or authentication behavior on the next `pnpm install`. Pin to an exact SDK version once
validated.

**DEP-2 — `tsx` in production scripts**  
`tsx` is a devDependency but `package.json` scripts use it for `foundation:run`, `reconcile:run`,
etc. Deployment on the VPS must use the compiled `dist/` output via `node`, not `tsx`
on-the-fly transpilation. Ensure systemd `ExecStart` references `node dist/cli/run-foundation.js`.

---

## 10. Adherence to AGENTS.md

| Requirement | Status |
|---|---|
| Testnet first | ✅ Enforced by `ExecutionGate` hardcode |
| Perps first | ✅ Asset registry supports both; only perps targeted in MVP |
| nktkas SDK integration | ✅ Used correctly throughout |
| No AI in live path | ✅ No AI calls anywhere in execution path |
| Strategy plugin contract | ❌ `src/strategies/` does not exist |
| Risk engine is final authority | ❌ `src/risk/` does not exist |
| One responsibility per module | ✅ Excellent adherence |
| No hidden mutable state | ✅ All state is reconstructable from SQLite |
| No placeholder architecture | ⚠️ Declared modules missing: intents, strategies, risk, candle-store |
| LOG.md maintained | ✅ Consistently updated |
| Strict typing | ✅ Near-maximal TypeScript strictness |
| Operational safety first | ✅ Trust gating, reconciliation-first, conservative defaults |
| `cloid` contract | ✅ Centralized, 16-byte hex enforced |
| Dead-man's switch | ⚠️ Primitive exists, no auto-refresh loop |
| Candle history (hard requirement) | ❌ Candle recorder does not exist |
| systemd deployment | ❌ No `.service` file |
| Strategy → intent pipeline | ❌ Intents layer does not exist |
| Batch cancel/modify | ❌ Only single-order operations |

---

## 11. Prioritized Recommendations

### P0 — Must fix before any live run (testnet or mainnet)

1. **Run the full smoke test with a real funded testnet account.** Place an order, modify it, cancel it, let one fill. Verify `order_state_transitions`, `execution_actions`, and `cloid_mappings` are all correct in SQLite.
2. **Fix the `-1` fallback in `mapFormattedModifyToSdk`.** Replace with a `throw` if both `clientOrderId` and `orderId` are undefined.
3. **Add a basic data retention policy.** Cap `market_events` and `user_event_records` at 7 days. Even a DELETE WHERE on startup is better than nothing.
4. **Add `listActiveOrders()` to `OrderStateRepository`.** Essential for risk engine and Telegram status.

### P1 — Phase 4 prerequisites

5. **Build `src/risk/risk-engine.ts`** as the mandatory authority between strategy intents and `ExecutionEngine`. At minimum: per-trade sizing from stop distance, max notional guard, trust-state gate, and spread guard.
6. **Build the candle recorder** (`src/marketdata/candle-store.ts`). Without it, no strategy can compute EMAs, ATR, or ADX from historical data.
7. **Add a schema migration system.** Even a simple `schema_migrations` table with versioned SQL scripts is sufficient.
8. **Replace `ExecutionGate` testnet hardcode** with `config.allowMainnetWrites` capability flag.

### P2 — Phase 5 prerequisites

9. **Define `src/strategies/interfaces.ts`** — the typed strategy plugin contract.
10. **Define `src/intents/intents.ts`** — the canonical intent union type.
11. **Implement `trend-pullback-v1`** using the indicator set specified in AGENTS.md.
12. **Add batch cancel/modify to `ExecutionEngine`.** Required for strategy shutdown and risk stop-outs.

### P3 — Phase 6 / operational hardening

13. **Build `src/telegram/`** with allowlist auth, read-only status commands, and privileged flatten/pause/reconcile flows.
14. **Add dead-man's switch auto-refresh service** that refreshes every N minutes during live operation.
15. **Add `src/services/metrics.ts`** — at minimum: win rate, expectancy, fill count, error count, reconnect count.
16. **Add `src/cli/run-paper.ts`** — paper trading mode using live market data without write-side execution.
17. **Write systemd `.service` file** in `scripts/` and document Ubuntu VPS deployment.
18. **Add a `fills` table** with one row per individual fill event for clean PnL and slippage reporting.

---

## 12. What Is Genuinely Good

To be direct: the engineering quality of Phases 1–3 is exceptional for a trading bot project at this stage.

- **`ExecutionNonceController` with `AsyncLocalStorage`** correlates nonces to action IDs without threading explicit context through every function. This is clever and correct.
- **BigInt decimal arithmetic** (`divideDecimalStrings`, `addDecimalStrings`) in fill-price averaging eliminates an entire class of floating-point bugs that have caused real losses in other bots.
- **The four-state trust model** (`trusted → reconciling → degraded → untrusted`) is the right abstraction. Most bots never bother with this and get wrecked on reconnect or crash recovery.
- **Every order state transition is persisted to SQLite** before and after every event source. The system is fully auditable. This is table-stakes in institutional-grade systems and most open-source bots never implement it.
- **`cloid_mappings` three-way join** (`internal correlation_id ↔ action_id ↔ exchange cloid`) is thoughtful because Hyperliquid can update the `cloid` on the ack, requiring you to store both the submitted cloid and the exchange-acknowledged version.
- **Reconciliation-first boot** is exactly what a serious trading bot needs. The system cannot accidentally trade on stale state.

---

*This audit was generated by Antigravity on 2026-04-13. Update this document after each completed phase.*
