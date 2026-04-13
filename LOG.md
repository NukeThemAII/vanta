# LOG

## 2026-04-04T20:00:06+02:00

### Objective
Execute Phase 1 / Foundation only:
- scaffold the TypeScript/Node.js project
- add strict env/config loading
- centralize Hyperliquid network switching
- bootstrap read-only Hyperliquid clients
- ingest BTC/ETH testnet market data over WebSocket
- persist boot/app/market events into SQLite
- provide a clean CLI smoke test with clean shutdown

### Files created/changed
- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.json`
- `.gitignore`
- `.env.example`
- `eslint.config.mjs`
- `vitest.config.ts`
- `src/config/markets.ts`
- `src/config/networks.ts`
- `src/config/env.ts`
- `src/core/types.ts`
- `src/core/errors.ts`
- `src/core/logger.ts`
- `src/core/runtime.ts`
- `src/exchange/hyperliquid-client.ts`
- `src/marketdata/normalizers.ts`
- `src/marketdata/ws-manager.ts`
- `src/persistence/schema.ts`
- `src/persistence/db.ts`
- `src/persistence/repositories/shared.ts`
- `src/persistence/repositories/app-boot-repository.ts`
- `src/persistence/repositories/app-event-repository.ts`
- `src/persistence/repositories/market-event-repository.ts`
- `src/services/foundation-service.ts`
- `src/app/container.ts`
- `src/app/bootstrap.ts`
- `src/app/shutdown.ts`
- `src/cli/run-foundation.ts`
- `tests/unit/config/env.test.ts`
- `tests/unit/config/networks.test.ts`
- `tests/unit/core/runtime.test.ts`

### What works now
- `pnpm`-managed Node 22 + strict TypeScript scaffold is in place.
- Environment loading is validated with `zod`, including network selection, watched markets, logging level, SQLite path, operator address, and optional API wallet private key.
- Network-specific Hyperliquid values are centralized in one config layer using SDK-exported API/WS/RPC endpoints.
- Read-only Hyperliquid bootstrap uses `InfoClient` with `metaAndAssetCtxs()` and `allMids()`, plus optional `clearinghouseState()`, `openOrders()`, and `userRateLimit()` when an operator address is configured.
- WebSocket market ingestion uses `SubscriptionClient` on testnet for BTC/ETH `allMids` and `trades`.
- SQLite persistence is initialized in WAL mode and records `app_boots`, `app_events`, and `market_events`.
- Clean shutdown handles `SIGINT` / `SIGTERM`, unsubscribes, closes the Hyperliquid WebSocket transport, closes SQLite, and records a stopped boot record.
- Runtime compatibility issue in this Node 22 environment was handled with a narrow `CloseEvent` polyfill so the SDK WebSocket transport can close cleanly.
- Verified commands:
  - `corepack pnpm typecheck`
  - `corepack pnpm lint`
  - `corepack pnpm test`
  - `corepack pnpm build`
  - `env VANTA_BOOTSTRAP_USER_STATE=false VANTA_SQLITE_PATH=./data/vanta-smoke.sqlite node dist/cli/run-foundation.js`
- Smoke verification wrote live testnet data into `data/vanta-smoke.sqlite`; latest verified boot ended in `status=stopped` with persisted app and market events.

### Known issues / blockers
- Operator-account bootstrap was not verified against a real configured operator address in this session; smoke verification ran with `VANTA_BOOTSTRAP_USER_STATE=false` because no operator address was available in the workspace.
- No reconciliation, order-state mirror, signer handling, or write-path logic exists yet by design; those belong to Phase 2+.
- Market data persistence is intentionally minimal for Phase 1 and does not yet include candle/book recorders, replay format, or retention policy.

### Exact next steps for the next agent session
1. Stay inside Phase 2 only: do not add strategy logic, Telegram, or order execution beyond the exchange-state/recovery foundation.
2. Add an asset registry that derives and caches perp asset ids from `metaAndAssetCtxs`, with explicit lookup APIs for future execution/risk modules.
3. Add persisted account/open-order mirrors and repositories for positions, open orders, and reconciliation events.
4. Implement startup reconciliation flow: load local state, fetch current exchange snapshots, compare, record mismatches, and gate live activity until state is consistent.
5. Add read-only recovery tests covering restart with persisted state, missing local records, and WebSocket reconnect / snapshot reload behavior.

## 2026-04-05T04:44:25+02:00

### Objective
Execute Phase 2 / Exchange State and Recovery only:
- build a centralized Hyperliquid asset registry
- mirror account state and open orders locally
- consume read-only user/account events where available
- persist registry/state/reconciliation data in SQLite
- implement deterministic reconciliation and runtime trust gating
- add read-only CLI commands for reconciliation and mirrored state inspection

### Files created/changed
- `package.json`
- `LOG.md`
- `src/app/container.ts`
- `src/core/trust-state.ts`
- `src/core/types.ts`
- `src/exchange/asset-registry.ts`
- `src/exchange/hyperliquid-client.ts`
- `src/exchange/open-order-mirror.ts`
- `src/exchange/reconciliation.ts`
- `src/exchange/user-event-normalizers.ts`
- `src/exchange/user-state-ws-manager.ts`
- `src/marketdata/ws-manager.ts`
- `src/persistence/repositories/asset-registry-repository.ts`
- `src/persistence/repositories/reconciliation-repository.ts`
- `src/persistence/repositories/runtime-state-repository.ts`
- `src/persistence/repositories/shared.ts`
- `src/persistence/repositories/state-snapshot-repository.ts`
- `src/persistence/repositories/user-event-repository.ts`
- `src/persistence/schema.ts`
- `src/portfolio/account-mirror.ts`
- `src/services/foundation-service.ts`
- `src/services/reconciliation-service.ts`
- `src/services/runtime-trust-controller.ts`
- `src/cli/run-reconcile.ts`
- `src/cli/show-account-state.ts`
- `src/cli/show-open-orders.ts`
- `tests/unit/core/runtime-trust-controller.test.ts`
- `tests/unit/exchange/asset-registry.test.ts`
- `tests/unit/exchange/open-order-reconciliation.test.ts`
- `tests/unit/portfolio/account-mirror.test.ts`

### What works now
- Hyperliquid metadata is normalized into a centralized asset registry with explicit perp asset ids, spot asset ids (`10000 + spot index`), symbol lookups, token metadata, and precision-related fields.
- Read-only account mirrors normalize operator address, margin summaries, cross-margin assumption, positions, spot balances, rate-limit data, sync timestamps, and staleness markers without leaking raw SDK objects into the rest of the app.
- Read-only open-order mirrors normalize snapshot data from `frontendOpenOrders` and persist stable identity fields needed for future order-state-machine work.
- SQLite schema now persists asset registry snapshots, account snapshots, position snapshots, open-order snapshots, normalized user events, reconciliation runs, reconciliation issues, and runtime trust-state transitions.
- Startup/manual reconciliation loads prior persisted state, fetches fresh exchange state, compares snapshots, records results, and drives explicit runtime trust states: `trusted`, `reconciling`, `degraded`, `untrusted`.
- Repeated reconciliation against unchanged exchange structure now stays clean. A Phase 2 defect where live price/funding context inside registry snapshots caused warning spam was fixed by diffing only structural registry fields.
- User/account WebSocket ingestion is wired for `clearinghouseState`, `spotState`, `openOrders`, `orderUpdates`, `userFills`, and `userEvents`, with normalized event persistence and mirror refreshes.
- `run-foundation` now performs startup reconciliation before long-running subscriptions, records trust state, degrades on transport uncertainty, and reconnects through the reconciliation path instead of assuming local state is correct.
- Read-only operator CLI commands exist and were verified:
  - `corepack pnpm reconcile:run`
  - `corepack pnpm state:account`
  - `corepack pnpm state:orders`
- Verified in this session:
  - `corepack pnpm typecheck`
  - `corepack pnpm lint`
  - `corepack pnpm test`
  - `corepack pnpm build`
  - `env VANTA_NETWORK=testnet VANTA_OPERATOR_ADDRESS=0x1111111111111111111111111111111111111111 VANTA_SQLITE_PATH=./data/vanta-phase2-verify.sqlite corepack pnpm reconcile:run`
  - same `reconcile:run` command repeated on the same database with `issueCount=0` again
  - `env VANTA_NETWORK=testnet VANTA_OPERATOR_ADDRESS=0x1111111111111111111111111111111111111111 VANTA_SQLITE_PATH=./data/vanta-phase2-verify.sqlite corepack pnpm state:account`
  - `env VANTA_NETWORK=testnet VANTA_OPERATOR_ADDRESS=0x1111111111111111111111111111111111111111 VANTA_SQLITE_PATH=./data/vanta-phase2-verify.sqlite corepack pnpm state:orders`
  - `env VANTA_NETWORK=testnet VANTA_OPERATOR_ADDRESS=0x1111111111111111111111111111111111111111 VANTA_SQLITE_PATH=./data/vanta-phase2-foundation.sqlite node dist/cli/run-foundation.js`
- The verified testnet account snapshot showed a trusted runtime state, zero open orders, zero perp positions, persisted spot balances, and clean SIGINT shutdown from the built foundation runner.

### Known issues / blockers
- Read-side recovery is in place, but there is still no signer registry, nonce-safe exchange writer, or order state machine. That is intentional and belongs to Phase 3+.
- Reconciliation currently treats structural snapshot drift as warnings, not hard failures, unless a service-level error occurs. Future phases may want stricter policy once write-path and recovery invariants are better defined.
- The user-event consumer persists normalized records and refreshes mirrors, but it does not yet deduplicate events into a canonical fill/order history model.
- Account/open-order verification in this session used a testnet operator with no live positions or open orders, so restart/reconcile behavior with active orders still needs explicit coverage.
- Spot pair size precision is inferred from the base token metadata because pair-level size decimals are not exposed directly by `spotMeta`; if Hyperliquid exposes a more exact source later, the registry should switch to it.

### Exact next steps for the next agent session
1. Stay inside Phase 3 only: do not add strategies, risk engine, Telegram, dashboards, or backtesting yet.
2. Build the signer/nonce-safe exchange layer around `@nktkas/hyperliquid`, including explicit signer ownership and future support for separate API wallets per live process.
3. Add the first read/write execution primitives only: place order, cancel order, modify order, batch modify, leverage update, and dead-man switch scheduling, all behind typed service boundaries.
4. Introduce the order state machine that consumes exchange-confirmed user events plus reconciliation snapshots, so open-order and fill history become authoritative and replayable.
5. Extend tests to cover restart/reconcile with active open orders and fills, plus write-path safety checks for nonce ownership and reduce-only order translation.

## 2026-04-08T15:07:23Z

### Objective
Execute Phase 3 / Write-Side Execution Foundation only:
- add signer/API-wallet-safe execution plumbing
- add single-process nonce-safe submission tracking
- centralize write-side asset/precision/order formatting
- add deterministic `cloid` generation and persistence mappings
- add execution primitives for place/cancel/cancel-by-cloid/modify/leverage/schedule-cancel
- add the first persisted order state machine
- add a testnet-only smoke CLI with explicit write opt-in
- keep all write actions gated behind trusted runtime state

### Files created/changed
- `LOG.md`
- `package.json`
- `.env.example`
- `src/core/types.ts`
- `src/core/errors.ts`
- `src/core/decimal.ts`
- `src/app/container.ts`
- `src/cli/testnet-smoke.ts`
- `src/config/env.ts`
- `src/config/networks.ts`
- `src/exchange/cloid-service.ts`
- `src/exchange/execution-client.ts`
- `src/exchange/execution-engine.ts`
- `src/exchange/execution-gate.ts`
- `src/exchange/execution-types.ts`
- `src/exchange/hyperliquid-client.ts`
- `src/exchange/nonce-manager.ts`
- `src/exchange/order-formatter.ts`
- `src/exchange/order-state-machine.ts`
- `src/exchange/signer-registry.ts`
- `src/exchange/user-state-ws-manager.ts`
- `src/persistence/schema.ts`
- `src/persistence/repositories/cloid-mapping-repository.ts`
- `src/persistence/repositories/execution-action-repository.ts`
- `src/persistence/repositories/order-state-repository.ts`
- `src/services/foundation-service.ts`
- `tests/fixtures/hyperliquid-fixtures.ts`
- `tests/unit/exchange/cloid-service.test.ts`
- `tests/unit/exchange/execution-gate.test.ts`
- `tests/unit/exchange/order-formatter.test.ts`
- `tests/unit/exchange/order-state-machine.test.ts`

### What works now
- Write-side identity is centralized in `SignerRegistry`, with explicit separation between operator/master address and API wallet signer, plus optional vault mode support.
- Nonce issuance is isolated in `ExecutionNonceController`, which records the exact nonce used per outbound action under the current single-writer-per-signer assumption.
- `HyperliquidOrderFormatter` is now the only place that resolves write-side asset ids, size precision, price precision, trigger formatting, and `cloid` normalization/generation before exchange submission.
- Deterministic 16-byte Hyperliquid-safe `cloid` generation exists in `CloidService`, and `cloid_mappings` persist the mapping between local action ids, correlation ids, and exchange-facing client order ids.
- `ExecutionEngine` now exposes typed primitives for:
  - place order
  - cancel order
  - cancel by cloid
  - modify order
  - update leverage
  - schedule cancel / clear schedule cancel
- SQLite persistence now records:
  - outbound execution actions
  - exchange nonce used per action
  - normalized request payloads
  - exchange responses / errors
  - `cloid` mappings
  - order state records
  - order state transitions
- `OrderStateMachine` persists and updates real lifecycle states:
  - `submitted`
  - `resting`
  - `partially_filled`
  - `filled`
  - `cancel_requested`
  - `canceled`
  - `modify_requested`
  - `rejected`
  - `needs_reconciliation`
- Exchange-confirmed user events and authoritative open-order snapshots now feed the order state machine through `UserStateWsManager` and reconciliation hydration.
- Runtime trust gating is enforced on every write path through `ExecutionGate`; Phase 3 write actions are blocked unless trust is `trusted` and the selected network is `testnet`.
- A testnet-oriented smoke command now exists at `pnpm smoke:execution`; it requires `--allow-write-actions`, logs the intended actions, and supports optional modify/leverage/schedule-cancel steps.
- Verified in this session:
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm lint`
  - `corepack pnpm build`
  - `corepack pnpm smoke:execution` -> correctly refuses without `--allow-write-actions`
  - `corepack pnpm smoke:execution --allow-write-actions` -> correctly fails fast without configured `VANTA_OPERATOR_ADDRESS` + `VANTA_API_WALLET_PRIVATE_KEY`
  - `env VANTA_NETWORK=testnet VANTA_OPERATOR_ADDRESS=0x1111111111111111111111111111111111111111 VANTA_SQLITE_PATH=./data/vanta-phase3-reconcile.sqlite corepack pnpm reconcile:run`
- The post-Phase-3 read path still reconciles cleanly on testnet after the new execution wiring; the verified manual reconcile run ended with `trustStateAfter=trusted` and `issueCount=0`.

### Known issues / blockers
- A full end-to-end live write smoke run was not executed in this session because no funded testnet operator/API wallet pair was available in the workspace. The execution spine is implemented and verified locally, but the actual place/modify/cancel path still needs one funded testnet validation run.
- The smoke CLI is intentionally conservative and does not try to auto-recover from all live edge cases in one pass; if a testnet order fills unexpectedly or exchange-side conditions differ, the operator still needs to inspect the persisted execution records and order-state table.
- The order state machine is real and persisted, but it is still Phase 3 scope only: no risk-policy layer, no reduce-only TP/SL orchestration, and no broader execution throttling beyond trust gating/nonces yet.

### Exact next steps for the next agent session
1. Stay inside Phase 4 only: do not add strategies, Telegram, dashboards, backtesting, or AI trading logic yet.
2. Before expanding behavior, run the new `pnpm smoke:execution --allow-write-actions ...` command once with a real funded testnet operator/API wallet pair and inspect `execution_actions`, `cloid_mappings`, and `order_state_transitions` for a clean place/modify/cancel cycle.
3. Build the risk engine on top of the new execution foundation: per-trade sizing from stop distance, exposure/leverage caps, stale-state guard, spread/slippage guard, and cooldown/drawdown stops.
4. Make the risk engine the mandatory authority between future strategy intents and `ExecutionEngine`; no future strategy module should call write-side execution directly.
5. Add tests for risk rejection/transform rules and for write-path blocking when account state becomes stale, degraded, or materially unreconciled after startup.

## 2026-04-13T15:10:07Z

### Objective
Review `AUDIT.md`, verify the findings against the actual codebase, and fix the audit-backed defects that belong to the already-completed phases without jumping ahead into Phase 4+ feature work.

### Files created/changed
- `LOG.md`
- `src/app/container.ts`
- `src/exchange/execution-engine.ts`
- `src/exchange/reconciliation.ts`
- `src/persistence/repositories/order-state-repository.ts`
- `src/services/reconciliation-service.ts`
- `tests/unit/exchange/open-order-reconciliation.test.ts`
- `tests/unit/persistence/order-state-repository.test.ts`

### What works now
- Reviewed `AUDIT.md` and I agree with most of it. The major red items around risk engine, strategies, intent layer, candle recorder, Telegram, systemd, paper mode, and metrics are real gaps, but they are still Phase 4–7 scope gaps rather than defects in the completed Phase 1–3 work.
- Fixed the audit’s concrete write-path defect in `ExecutionEngine`: `mapFormattedModifyToSdk` no longer falls back to `oid = -1`. Modify translation now throws immediately if neither `clientOrderId` nor `orderId` is present.
- Added `OrderStateRepository.listActiveOrders(operatorAddress)` so the codebase can query non-terminal local order states directly. This closes the repository gap the audit called out and prepares the risk engine / operator tooling for active-order inspection.
- Tightened reconciliation so it now compares local non-terminal `order_state_records` against the exchange’s authoritative open-order snapshot. Reconciliation now raises explicit errors for:
  - local active orders missing on the exchange
  - exchange open orders missing from local order-state records
- Tightened account drift policy for positions: position additions/removals/changes are now reconciled as `error` severity, not `warn`, which means unexpected position drift can push runtime trust to `untrusted`.
- Added regression coverage for the new reconciliation and repository behavior:
  - active-order repository queries
  - local-vs-exchange open-order drift detection
  - position drift severity escalation
- Verified in this session:
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm lint`
  - `corepack pnpm build`
  - `env VANTA_NETWORK=testnet VANTA_OPERATOR_ADDRESS=0x1111111111111111111111111111111111111111 VANTA_SQLITE_PATH=./data/vanta-audit-reconcile.sqlite corepack pnpm reconcile:run`
- The audited reconciliation changes were confirmed live against testnet; the verified manual reconcile run completed with `trustStateAfter=trusted` and `issueCount=0`.

### Known issues / blockers
- The audit is correct that a full real-credential `smoke:execution --allow-write-actions` cycle is still missing. That remains the most important unresolved verification item before risk-engine work depends on the write path.
- The audit is also correct that there is still no migration framework, no retention/housekeeping service, no candle recorder, no fills table, no batch cancel/modify, no paper mode, and no systemd/Telegram/metrics layer yet. Those are still open.
- `ExecutionGate` is still deliberately hardlocked to `testnet` for the completed Phase 3 work. That is correct for now, but it will need to become an explicit capability flag before any mainnet readiness work.

### Exact next steps for the next agent session
1. Stay inside Phase 4 only: build the risk engine and its guards, not strategies or Telegram yet.
2. Before relying on write-side behavior for risk decisions, run one funded testnet `smoke:execution --allow-write-actions` cycle and inspect `execution_actions`, `cloid_mappings`, `order_state_records`, and `order_state_transitions`.
3. Build `src/risk/` as the mandatory gate in front of `ExecutionEngine`, starting with per-trade sizing from stop distance, max notional / leverage caps, stale-state blocking, and spread/slippage guards.
4. Use the new `listActiveOrders()` query and stricter reconciliation results inside the risk engine so active-order count and state-trust checks are authoritative.
5. After the risk engine lands, the next highest-priority hardening item from the audit is the candle/book/trade recorder and a basic retention policy for `market_events`, `user_event_records`, and `order_state_transitions`.

## 2026-04-13T15:33:12Z

### Objective
Execute the next bounded Phase 4 slice only:
- add validated risk configuration
- build a centralized risk engine in front of write-side execution
- add exposure/leverage/slippage/stale-state guards
- persist inspectable risk decisions
- add a read-only operator command for current risk state

### Files created/changed
- `LOG.md`
- `package.json`
- `.env.example`
- `src/app/container.ts`
- `src/config/env.ts`
- `src/config/risk.ts`
- `src/core/decimal.ts`
- `src/core/errors.ts`
- `src/core/types.ts`
- `src/exchange/execution-engine.ts`
- `src/exchange/execution-types.ts`
- `src/persistence/schema.ts`
- `src/persistence/repositories/risk-event-repository.ts`
- `src/risk/types.ts`
- `src/risk/risk-engine.ts`
- `src/risk/guards/exposure.ts`
- `src/risk/guards/leverage.ts`
- `src/risk/guards/slippage.ts`
- `src/risk/guards/stale-state.ts`
- `src/cli/show-risk-state.ts`
- `tests/unit/config/env.test.ts`
- `tests/unit/exchange/execution-gate.test.ts`
- `tests/unit/risk/risk-engine.test.ts`

### What works now
- Risk config is now first-class and validated from env. The bot can parse and validate:
  - max order notional
  - max open orders
  - max concurrent positions
  - aggressive price deviation in bps
  - leverage cap as a fraction of exchange max leverage
  - default risk fraction of account
  - optional stop-loss enforcement for new exposure
- `RiskEngine` now sits directly in front of `ExecutionEngine` for:
  - `place_order`
  - `modify_order`
  - `update_leverage`
- New write-side risk guards are implemented and persisted:
  - fresh-account-state guard
  - max-open-orders guard
  - max-concurrent-positions guard
  - max-order-notional guard
  - aggressive-price-deviation/slippage guard
  - leverage-cap / cross-only guard
- Place orders now support optional risk metadata through `PlaceOrderRequest.risk`, including stop-loss-aware sizing inputs. The engine can:
  - reject oversize entries against a stop-based risk budget, or
  - cap size deterministically when `sizingMode: "cap"` is requested
- Risk decisions are persisted in the new `risk_event_records` table with decision type, market context, trust state, and structured details for later inspection.
- Added `pnpm state:risk`, a read-only CLI that prints:
  - current runtime trust state
  - active risk config
  - latest persisted account/open-order snapshot summary
  - recent risk decisions
- Verified in this session:
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm lint`
  - `corepack pnpm build`
  - `env VANTA_SQLITE_PATH=./data/vanta-risk-state.sqlite corepack pnpm state:risk`
  - `env VANTA_NETWORK=testnet VANTA_OPERATOR_ADDRESS=0x1111111111111111111111111111111111111111 VANTA_SQLITE_PATH=./data/vanta-phase4-reconcile.sqlite corepack pnpm reconcile:run`
  - `env VANTA_NETWORK=testnet VANTA_OPERATOR_ADDRESS=0x1111111111111111111111111111111111111111 VANTA_SQLITE_PATH=./data/vanta-phase4-reconcile.sqlite corepack pnpm state:risk`
- The read-side recovery path still reconciles cleanly after the Phase 4 wiring changes; the verified manual testnet reconcile run completed with `trustStateAfter=trusted` and `issueCount=0`.

### Known issues / blockers
- This is only the first Phase 4 slice. The risk engine does not yet implement:
  - drawdown stops
  - consecutive-loss cooldowns
  - funding guards
  - rate-limit-headroom guards
  - stale-market-data / book-quality guards
- No funded testnet write smoke was run in this session, so the new risk-gated write path still needs one live place/modify/cancel verification run with real testnet credentials.
- Risk decisions are persisted, but there is still no separate strategy-intent layer. Strategies do not exist yet, so `ExecutionEngine` remains the current integration point for the risk gate by design.
- `state:risk` is read-only and local-state-based; it does not force reconciliation itself. Operators should continue running `reconcile:run` before treating stale persisted state as trustworthy.

### Exact next steps for the next agent session
1. Stay inside Phase 4 only. Do not start strategies, Telegram, dashboards, paper mode, or backtesting yet.
2. Run one funded testnet `smoke:execution --allow-write-actions ...` cycle against the new risk-gated execution path and inspect `execution_actions`, `risk_event_records`, `cloid_mappings`, and `order_state_transitions`.
3. Finish the remaining Phase 4 guards: drawdown stops, consecutive-loss cooldowns, funding-based entry blocking, and rate-limit / stale-market-data protection.
4. Add a minimal risk-event/operator inspection test around real persisted decisions after a write-side smoke run so the next phase inherits hard evidence, not assumptions.
5. Only after Phase 4 is complete should the next agent move into Phase 5 strategy runtime and the first `trend-pullback-v1` intent pipeline.
