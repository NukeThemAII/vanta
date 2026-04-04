# AGENTS.md

## Project identity

**Bot name:** Vanta
**Repo name:** `vanta-hl`
**Mission:** Build a production-grade, modular Hyperliquid trading bot for a single operator running on an Ubuntu VPS, using the `@nktkas/hyperliquid` TypeScript SDK, with testnet-first development, clean mainnet switching, deterministic execution, pluggable strategies, strong risk controls, and Telegram-based monitoring/control.

Vanta is not a toy bot, not a monolithic script, and not an AI free-for-all. It is a disciplined trading system with clear module boundaries, typed interfaces, replayable state, measurable behavior, and safe operational defaults.

---

## Non-negotiable rules

1. **Testnet first.** All initial execution, order lifecycle, Telegram control, and strategy validation must run on Hyperliquid testnet before any mainnet deployment.
2. **Perps first, spot second.** The MVP targets perpetuals because long/short, leverage control, TP/SL, and strategy expression are much stronger there. Spot support should be architected in, but not drive the first delivery.
3. **Use the nktkas SDK as the exchange integration layer.** Do not hand-roll signing or raw request plumbing unless strictly necessary.
4. **Deterministic live path.** The live trading path must remain deterministic and rules-based. AI may assist research, config generation, and code edits, but AI must not directly decide live trades in the MVP.
5. **Strategy plugins, not strategy spaghetti.** Every strategy must live in its own file/module and implement the same typed contract.
6. **Risk engine is final authority.** Strategies propose intents. Risk/execution modules decide whether those intents are allowed.
7. **One responsibility per module.** No file should mix market data ingestion, signal generation, risk checks, order translation, persistence, and Telegram handling.
8. **No hidden mutable state.** Important bot state must be reconstructable from persisted events, exchange snapshots, and logs.
9. **No placeholder architecture.** If a feature is declared, it must either exist or be explicitly marked out of scope.
10. **Always maintain `LOG.md`.** Every meaningful work session must update `LOG.md` with what changed, what still blocks progress, and what the next agent should do.
11. **Strict typing.** No loose `any`-driven design. Types must describe exchange entities, strategy inputs, intents, order state, and persisted records.
12. **Operational safety over feature count.** A smaller bot that survives production is better than a feature-rich bot that dies from nonce collisions, stale orders, or bad risk controls.

---

## Why this stack

### Runtime and language

* **Node.js 22 LTS**
* **TypeScript** with strict mode
* **pnpm** as package manager

Reason: stable VPS runtime, excellent TypeScript tooling, easy integration with the nktkas SDK, easy modular growth, easy CI, and fast iteration with Codex/OpenClaw.

### Core packages

* **`@nktkas/hyperliquid`** for Hyperliquid API access
* **`viem`** for wallet/account handling where needed
* **`zod`** for environment/config validation
* **`pino`** for structured logs
* **`grammy`** for Telegram bot control and notifications
* **`vitest`** for unit/integration tests
* **`better-sqlite3`** for local durable state in MVP

### Storage choice

Use **SQLite in WAL mode** for the MVP because the initial target is a single-user Ubuntu VPS. Hide persistence behind repositories so Postgres can be added later without rewriting the domain logic.

### Process management

Use **systemd**, not PM2, for long-running live services on Ubuntu.

### Scheduling

Use the app’s own timers/event loop for live trading logic. Use **crontab** only for:

* backups
* log rotation helpers
* daily summaries
* research/report jobs

Do not let crontab drive the live trading loop.

---

## Hyperliquid facts the code must reflect

The implementation must be shaped around the actual behavior and limits of Hyperliquid.

### Networks

The bot must support clean switching between:

* **Mainnet** API / WebSocket endpoints
* **Testnet** API / WebSocket endpoints

All network-specific URLs, chain labels, and toggles must live in a single network config layer.

### Trading surfaces

Hyperliquid exposes enough surface area for a serious trading bot:

* **Perps**
* **Spot**
* **Builder-deployed perps (HIP-3)**
* **Outcome metadata on testnet**

The MVP should actively trade **perps only**, while preserving extension points for spot.

### Read capabilities the bot should use

The bot design must account for these categories of exchange state:

* all mids
* open orders
* frontend open orders
* user fills
* historical orders
* order status by oid/cloid
* user rate limits
* L2 book snapshots
* candle snapshots
* perp metadata and asset contexts
* perp account summary / clearinghouse state
* spot metadata and spot account state
* funding history
* predicted funding
* TWAP state/fills where relevant

### Write capabilities the bot should use

The bot design must support at least these exchange actions:

* place order
* cancel order(s)
* cancel by cloid
* modify order
* batch modify orders
* update leverage
* Cross Margin only for MVP; isolated margin pool management is deferred until later phases
* schedule cancel / dead man’s switch
* optional TWAP orders

The trading layer must understand standard order fields like:

* asset id
* side
* size
* limit vs trigger order
* reduce-only
* tif (`Alo`, `Ioc`, `Gtc`)
* TP/SL trigger fields
* client order id (`cloid`)

### `cloid` contract

`cloid` generation must strictly adhere to Hyperliquid requirements. Treat `cloid` as a 16-byte hex identifier and centralize generation in one utility/module. Do not pass human-readable strings directly. If human-readable correlation is needed, persist a separate mapping from internal correlation ids to the exchange-safe `cloid`.

### Important API/rate-limit realities

The code must be conservative with rate usage and websocket load.

Design assumptions to enforce:

* REST requests share a weighted per-minute budget.
* `exchange` actions are cheap individually but batching matters.
* some `info` requests are much heavier than others.
* websocket connection/subscription counts are limited.
* websocket message rates are limited.
* user/address-based action limits exist.

This means:

* prefer **websocket subscriptions** for live state
* use REST for **initial snapshots**, reconciliation, recovery, and audits
* cache metadata aggressively
* batch cancels/modifies when possible
* do not spam polling loops
* do not rebuild strategy state from repeated heavyweight API calls

### Builder tagging

Even though public builder-fee monetization is out of scope for MVP, the execution engine should be designed so a builder id can be attached cleanly from day one. Default behavior should be no builder fee or a minimal internal tracking-oriented setting if and when enabled later. Do not scatter builder tagging logic across order call sites.

### Nonces and signer model

Nonces are stored **per signer**. This is critical.

Rules:

* each live trading process must have a clearly defined signer
* do not let multiple concurrent writers share one signer casually
* use a separate API wallet / agent wallet per independent live process when needed
* if running multiple strategy workers in parallel, they must not produce nonce collisions

### Asset id handling

The code must centralize asset-id resolution:

* perp assets use index from perp metadata
* spot assets use `10000 + spot index`
* builder-deployed perps use the builder-perp asset-id scheme

No strategy file is allowed to hardcode random asset ids.

### Dead man’s switch

Hyperliquid supports `scheduleCancel`.

Use it carefully:

* it is a safety feature, not a heartbeat spam feature
* the bot should refresh it periodically with a sensible horizon
* it should not be allowed to trigger accidentally in normal operation
* actual trigger count limits must be respected

### Candle history constraint

The exchange only provides a limited recent candle window. Therefore:

* the bot must include a **local market data recorder** from day one
* live websocket candles/trades should be persisted for backtesting and research
* do not rely on the exchange as infinite historical storage

This is a hard architectural requirement.

---

## Product scope

## MVP scope

Build a private operator bot with:

* Hyperliquid **testnet** execution
* clean **mainnet switch** via config
* **perp trading** on a small whitelist of liquid markets
* pluggable strategies loaded from files
* risk engine with per-strategy and global controls
* Telegram notifications and limited control commands
* persistent local database for orders, fills, positions, metrics, and event logs
* recovery/reconciliation on restart
* dry-run mode and paper mode

### First live market set

Start with:

* `BTC`
* `ETH`
* `SOL`
* optional `HYPE` only after the rest is stable

Do not begin with illiquid pairs, random small caps, or builder-deployed perps.

### Explicitly out of scope for MVP

* multi-user SaaS
* user billing
* builder fee monetization flows
* web dashboard as a required dependency
* cross-exchange arbitrage
* autonomous AI live trading
* market making on thin books
* unmanaged martingale/grid behavior

---

## Repo layout

Use a clean, single-repo TypeScript layout.

```text
axiom-hl/
  AGENTS.md
  LOG.md
  README.md
  package.json
  tsconfig.json
  .env.example
  src/
    app/
      bootstrap.ts
      shutdown.ts
      container.ts
    config/
      env.ts
      networks.ts
      markets.ts
      strategy-maps.ts
      risk.ts
    core/
      events.ts
      clock.ts
      errors.ts
      types.ts
    exchange/
      hyperliquid-client.ts
      signer-registry.ts
      asset-registry.ts
      execution-engine.ts
      order-router.ts
      order-state-machine.ts
      reconciliation.ts
    marketdata/
      ws-manager.ts
      snapshot-loader.ts
      candle-store.ts
      book-store.ts
      trade-store.ts
      indicators/
    portfolio/
      account-mirror.ts
      positions.ts
      balances.ts
      pnl.ts
    risk/
      risk-engine.ts
      guards/
        exposure.ts
        leverage.ts
        drawdown.ts
        funding.ts
        cooldown.ts
        slippage.ts
    strategies/
      interfaces.ts
      registry.ts
      runtime.ts
      common/
      trend-pullback/
        strategy.ts
        params.ts
      mean-reversion/
        strategy.ts
        params.ts
    intents/
      intents.ts
      translators.ts
    telegram/
      bot.ts
      commands.ts
      notifications.ts
      auth.ts
    persistence/
      db.ts
      schema.ts
      repositories/
    services/
      health.ts
      metrics.ts
      reports.ts
      recorder.ts
    cli/
      run-live.ts
      run-paper.ts
      run-backtest.ts
      testnet-smoke.ts
  config/
    markets/
      btc.yaml
      eth.yaml
      sol.yaml
    strategies/
      trend-pullback.default.yaml
      mean-reversion.default.yaml
  scripts/
  tests/
    unit/
    integration/
    fixtures/
```

---

## Architectural principles

### 1. Event-driven core

The bot should be **event-driven**, not a giant polling loop.

Primary event sources:

* websocket market data
* websocket user updates
* timer ticks
* reconciliation snapshots
* Telegram control commands

Strategies consume normalized events and emit **trade intents**, not raw exchange requests.

### 2. Strategy → intent → risk → execution pipeline

The pipeline must be:

1. Market/user event arrives
2. Strategy evaluates state
3. Strategy emits intent(s)
4. Risk engine approves/rejects/transforms
5. Execution engine translates into concrete HL orders/actions
6. Order state machine tracks outcomes
7. Persistence records everything

This separation is mandatory.

### 3. Reconciliation first

On boot or reconnect, the bot must:

* load local persisted state
* fetch current account/open-order/position snapshots
* fetch recent fills/order history needed for reconciliation
* reconcile differences
* rebuild internal state deterministically
* only then enable active trading

The Order State Machine must prioritize exchange-confirmed user events, especially fills, over local assumptions. If websocket connectivity drops or state becomes uncertain, the bot must pause new trading, reconcile via REST snapshots plus recent fills/orders, and resume only after discrepancies are resolved.

The bot must never assume its local view is perfect after restart.

### 4. Config-driven market assignment

Each market should be mapped to a strategy by config, not by hardcoded branching.

Example idea:

* BTC -> `trend-pullback`
* ETH -> `trend-pullback`
* SOL -> `mean-reversion`

This must be changeable without redesigning the whole bot.

### 5. Live, paper, and backtest share the same strategy contract

The same strategy implementation must be runnable in:

* live mode
* paper mode
* offline backtest/replay mode

Do not fork separate signal logic for simulation vs live.

---

## Strategy plugin contract

Every strategy module must implement a strict contract.

A strategy must:

* declare its id/name
* declare supported market types
* expose default parameters
* accept normalized market/account context
* emit typed intents only
* maintain its own internal state cleanly
* be unit-testable without network access

A strategy is **not** allowed to:

* call Hyperliquid directly
* send Telegram messages directly
* read raw environment variables
* mutate global singleton state
* bypass risk checks

### Intents

Strategies should emit high-level intents such as:

* `ENTER_LONG`
* `ENTER_SHORT`
* `ADD_REDUCE_ONLY_TP`
* `ADD_REDUCE_ONLY_SL`
* `MOVE_STOP`
* `REDUCE_POSITION`
* `CLOSE_POSITION`
* `CANCEL_ORDER`
* `CANCEL_ALL_FOR_MARKET`
* `NOOP`

`NOOP` intents should be silently absorbed by the runtime/execution layer and only logged at `debug`/`trace` level when useful for troubleshooting. They must not flood `info` logs.

Execution details like maker/post-only vs IOC fallback belong to execution logic, informed by strategy hints.

---

## The first strategy to build

## Strategy name

**`trend-pullback-v1`**

This should be the first serious strategy because it is compatible with:

* liquid perp books
* both long and short trading
* market regimes where directional structure exists
* controlled risk with clean invalidation levels

It is a much better MVP than starting with a market-maker or an overfit AI trader.

## Strategy thesis

Only trade liquid perp markets when the higher-timeframe trend is clear, then enter on lower-timeframe pullbacks with volatility, funding, and execution filters.

The goal is not to predict every move. The goal is to:

* avoid chop
* avoid overtrading
* trade only when trend + structure + execution conditions align
* size modestly
* cut invalid trades fast
* let strong moves pay for many small scratches

## Data inputs

Use these inputs:

* 1m candles
* 5m candles
* 15m candles
* L2 book snapshots / live book updates
* live mids/trades
* perp asset context
* funding data / predicted funding where useful
* account/position/open-order state

## Indicators / derived features

Compute locally:

* EMA 20 / 50 / 200
* ATR 14
* RSI 14
* ADX or another trend-strength measure
* rolling volume z-score
* spread in bps
* short-horizon realized volatility
* order-book imbalance
* distance from local swing high/low
* funding z-score or funding threshold filter

## Regime filter

Only allow entry if one of these regimes is active:

### Long regime

* 15m EMA50 > EMA200
* 5m EMA20 > EMA50
* 15m trend slope positive
* ADX/trend-strength above threshold
* spread/slippage conditions acceptable
* funding not extremely hostile to longs

### Short regime

* 15m EMA50 < EMA200
* 5m EMA20 < EMA50
* 15m trend slope negative
* ADX/trend-strength above threshold
* spread/slippage conditions acceptable
* funding not extremely hostile to shorts

### No-trade regime

Do not trade when:

* EMAs are tangled
* ATR is too low relative to noise
* spread is too wide
* order book is unstable
* funding is too extreme against the trade direction
* recent loss cooldown is active
* daily/global risk stop is active

## Entry logic

### Long entry

1. Regime is long.
2. Price pulls back on the 5m timeframe toward the fast trend zone.
3. RSI cools off from prior momentum and resets into a neutral-supportive zone.
4. Price confirms by reclaiming short-term structure on 1m/5m.
5. Order-book imbalance or tape confirms buyers are not absent.
6. Strategy emits `ENTER_LONG` with an initial invalidation level and TP/SL hints.

### Short entry

Mirror of long entry.

## Execution preference

Use a **maker-first** execution policy on liquid markets:

* attempt post-only entry near the best level when risk/reward allows
* if momentum urgency is high and slippage remains acceptable, allow IOC fallback
* avoid blind crossing unless explicitly justified

## Initial stop logic

Use an actual invalidation stop, not a vibe stop.

The initial stop should be derived from:

* recent swing invalidation
* ATR buffer
* structure break

Then place a reduce-only stop-loss trigger order when supported by the execution layer.

## Take-profit logic

Default ladder:

* take partial at **1R**
* take additional partial at **2R**
* trail the runner using either:

  * ATR-based trail, or
  * 5m EMA break, or
  * local structure trail

## Time stop

If the market does not expand within a defined candle window after entry, flatten or reduce. Stale trades waste margin and often turn into chop losses.

## Hard strategy restrictions

* no martingale
* no averaging down losers
* one net position per market
* one active primary entry path per market
* no revenge trading after stop-out
* no entry during reconciliation state

---

## Risk engine rules

The risk engine is the real boss.

### Per-trade risk

Start with conservative defaults:

* risk a small fixed fraction of account value per trade
* size from stop distance, not from vibes
* cap notional and leverage by market

### Portfolio rules

Enforce:

* max concurrent positions
* max correlated exposure
* max gross notional
* max net directional bias
* max notional per market
* max leverage per market

### Loss controls

Enforce:

* per-trade stop required
* daily drawdown stop
* rolling weekly drawdown stop
* consecutive loss cooldown
* strategy-level disable switch after repeated failure

### Execution guards

Reject or transform intents when:

* spread is above threshold
* expected slippage is too high
* order size violates exchange precision or min constraints
* account state is stale
* local state and exchange state diverge materially
* rate-limit headroom is too low

### Funding guard

Do not blindly carry positions into hostile funding conditions.

For directional strategies:

* block new longs when predicted/current funding is excessively long-crowded
* block new shorts when predicted/current funding is excessively short-crowded
* optionally reduce runner size before high-cost funding windows

---

## Telegram control plane

Telegram is the preferred first control surface over a web UI.

Reason:

* faster to ship
* safer operationally on a private VPS
* easier to secure with allowlists
* perfect for notifications, health checks, and emergency actions

### Telegram v1 capabilities

Implement:

* startup/shutdown alerts
* fill alerts
* order reject/error alerts
* daily PnL summary
* strategy disable alert
* reconciliation mismatch alert
* heartbeat/health alert

### Telegram commands

Implement safe commands such as:

* `/status`
* `/positions`
* `/orders`
* `/pnl`
* `/risk`
* `/pause`
* `/resume`
* `/disable <market>`
* `/enable <market>`
* `/flatten <market>`
* `/flatten_all`
* `/reconcile`
* `/help`

### Safety rules for Telegram

* allowlist specific Telegram user IDs only
* commands that can move money or flatten positions should require confirmation or privileged mode
* no arbitrary shell execution
* no direct eval of strategy code from Telegram messages

---

## AI / Codex / OpenClaw / Gemini usage

AI is welcome in the development workflow, but the bot must be designed so the live trading path does not depend on LLM availability or judgment.

### Allowed AI roles

* propose code changes
* write or edit strategy files
* generate research reports
* suggest parameter sets
* summarize logs and metrics
* generate markdown postmortems

### Forbidden AI roles in MVP

* directly placing live trades
* bypassing risk checks
* mutating running bot memory with free-form instructions
* receiving private keys in prompts/logs

### Safe pattern

Build an optional **research agent lane**:

* reads recorded data and summaries
* proposes parameter/config diffs
* writes reports into `/reports` or PR-style patches
* requires human/operator review before deployment

This gives us AI leverage without letting a language model become the execution engine.

---

## Persistence and observability

Persist at minimum:

* orders submitted
* order acknowledgements
* order state changes
* fills
* positions by market
* realized/unrealized pnl snapshots
* risk events
* strategy decisions/intents
* reconciliation events
* Telegram command audit trail
* market data checkpoints for replay/backtest

### Logging

All services must produce structured logs with:

* timestamp
* service/module
* market
* strategy id
* account/network
* event type
* correlation id / cloid where relevant

### Metrics

Track and expose at minimum:

* win rate
* expectancy
* avg winner / avg loser
* slippage
* maker vs taker ratio
* time in trade
* max adverse excursion
* max favorable excursion
* strategy hit rate by market
* daily drawdown
* API error counts
* reconnect counts

---

## Testnet-first development plan

### Phase 1 — foundation

* bootstrap repo
* validate environment/config loading
* add network switching
* connect to Hyperliquid testnet via nktkas SDK
* fetch metadata, account state, open orders
* subscribe to websocket feeds
* persist incoming data

### Phase 2 — exchange state and recovery

* build asset registry
* build signer/nonce-safe exchange layer
* build account mirror and open-order mirror
* implement reconciliation on startup
* implement order state machine

### Phase 3 — execution primitives

* place order
* cancel order
* modify order
* batch modify
* update leverage
* reduce-only TP/SL support
* dead-man switch scheduling
* dry-run mode

### Phase 4 — risk engine

* sizing from stop distance
* exposure guard
* leverage guard
* drawdown guard
* cooldown logic
* stale-state guard
* spread/slippage guard

### Phase 5 — strategy runtime

* strategy interface
* market-to-strategy config mapping
* `trend-pullback-v1`
* replay runner for recorded data
* paper trading runner

### Phase 6 — Telegram operations

* alerts
* read-only commands
* privileged controls
* pause/resume/flatten flows

### Phase 7 — hardening

* restart recovery tests
* websocket reconnect tests
* testnet soak run
* edge-case handling for rejects / partial fills / cancel races
* systemd unit files
* backup/retention scripts

### Phase 8 — mainnet readiness

Only after the following are true:

* testnet soak is stable
* reconciliation is proven
* risk rules are proven
* logs/metrics are useful
* Telegram emergency controls work
* operator runbook exists

---

## Backtesting and research requirements

The bot must not ship without a path to replay and evaluate strategy behavior.

Requirements:

* recorded live data should be reusable for replay
* strategy logic must be executable offline
* backtest results must report realistic metrics, not just PnL
* fee and slippage assumptions must be explicit
* funding should be included for perp holds where relevant

Do not produce fake “profitable” backtests by ignoring fees, ignoring funding, or filling at impossible prices.

---

## Mainnet deployment philosophy

When mainnet arrives:

* start with tiny size
* isolate the live signer and secrets
* use conservative leverage
* trade only the most liquid approved markets
* roll out one strategy at a time
* do not enable multiple new features simultaneously
* keep paper mode running in parallel when helpful

Vanta should earn the right to scale.

---

## Security rules

* Never hardcode secrets.
* Use env vars for private keys and Telegram tokens.
* Provide `.env.example` with placeholders only.
* Never print secrets in logs.
* Never send secrets to Telegram.
* Keep a strict separation between research tools and live execution credentials.
* Validate every config file before startup.
* Refuse to start on malformed config.

---

## Coding standards

* Prefer small files with clear ownership.
* Prefer composition over inheritance.
* Write pure functions for indicators, sizing, and signal calculations where possible.
* Side effects belong in service/adaptor layers only.
* Add tests for indicator math, risk checks, and strategy state transitions.
* Every public module must have a clear type contract.
* Name functions by behavior, not by vague jargon.
* Do not scatter magic numbers; centralize parameters in strategy configs.
* Use `cloid` consistently for correlation and reconciliation.

---

## Definition of done

A feature is only done when:

* code is implemented
* types are clean
* tests exist where appropriate
* logs are meaningful
* config is validated
* recovery behavior is considered
* `LOG.md` is updated
* the next agent can continue without guessing

---

## First deliverable target

The first serious deliverable should be:

**A testnet-only Vanta bot that can:**

* connect to Hyperliquid testnet
* load metadata and account state
* subscribe to market/user websockets
* persist market and execution events
* run one pluggable strategy on BTC/ETH
* place and manage perp orders with TP/SL
* expose Telegram monitoring and emergency controls
* recover cleanly after restart

That is the correct foundation. Everything else grows from there.

---

## Work logging requirement

Maintain a `LOG.md` file with sections like:

* date/time
* objective
* files changed
* behavior added/fixed
* known issues
* next highest-priority tasks

Every agent session must leave the repo in a state where another agent can continue immediately.

---

## Final instruction to the coding agent

Build Vanta as if it will eventually trade real size.

That means:

* clean boundaries
* no shortcut architecture
* no fake abstractions
* no fragile one-file mess
* no unsafe AI magic
* no hand-wavy strategy rules

Make it boringly reliable, deeply inspectable, and easy to extend.

The edge comes from disciplined design, careful risk, robust execution, and continuous iteration — not from pretending we can predict every candle.
