# ⚫ Vanta

```text
██╗   ██╗ █████╗ ███╗   ██╗████████╗ █████╗
██║   ██║██╔══██╗████╗  ██║╚══██╔══╝██╔══██╗
██║   ██║███████║██╔██╗ ██║   ██║   ███████║
╚██╗ ██╔╝██╔══██║██║╚██╗██║   ██║   ██╔══██║
 ╚████╔╝ ██║  ██║██║ ╚████║   ██║   ██║  ██║
  ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝
```

> **Vanta** is a modular, testnet-first Hyperliquid trading bot for a private operator running on an Ubuntu VPS.
> Built for **serious execution**, **strict risk controls**, **pluggable strategies**, and **clean operations** — not for YOLO scripting.

---

## 🧭 What Vanta is

Vanta is a **production-minded trading system** for Hyperliquid, designed around:

* ⚙️ **TypeScript + Node.js**
* 🌐 **`@nktkas/hyperliquid` SDK**
* 🧪 **Hyperliquid testnet-first development**
* 📡 **WebSocket-driven market state**
* 🧠 **Pluggable strategy files**
* 🛡️ **Central risk engine**
* 📲 **Telegram control + notifications**
* 💾 **Local persistence + restart recovery**

It is designed so each market can run a different strategy, while the execution and risk layers stay unified and predictable.

---

## 🎯 Design goals

Vanta is built around a few hard principles:

* **Perps first** — long/short expression, leverage controls, trigger orders, structured exits
* **Deterministic execution** — strategy emits intents, risk engine decides, execution layer acts
* **Testnet before mainnet** — no skipping validation
* **Modular by default** — easy to extend without rewriting the core
* **Operationally boring** — logs, reconciliation, health checks, predictable failure handling
* **AI-assisted development, not AI-chaos trading** — agents help build and improve the system, but do not bypass the live risk path

---

## 🧱 Core feature set

### Exchange capabilities

Vanta is designed around what Hyperliquid actually allows:

* 📈 perpetuals
* 💱 spot support path
* 📚 market metadata + asset contexts
* 🕯️ candle snapshots
* 📖 L2 book + live market feeds
* 🧾 open orders / order status / historical orders
* 💸 fills + account state
* 🎚️ leverage updates
* 🧨 reduce-only TP/SL handling
* 🧯 dead-man switch scheduling

### Bot capabilities

* 🧩 strategy plugin loading
* 🧮 indicator computation
* 🛡️ global + per-market risk controls
* 🔁 startup reconciliation
* 🗃️ local event storage for replay/backtesting
* 📬 Telegram alerts and command handling
* 🧪 dry-run / paper / testnet modes
* 🔄 clean mainnet switch via config

---

## 🏗️ Architecture

```text
market data ws/rest
        │
        ▼
┌────────────────────┐
│  market state      │
│  recorder/cache    │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│  strategy runtime  │  ← one strategy per market, config-mapped
└─────────┬──────────┘
          │ intents
          ▼
┌────────────────────┐
│   risk engine      │  ← final authority
└─────────┬──────────┘
          │ approved actions
          ▼
┌────────────────────┐
│ execution engine   │  ← translate to Hyperliquid orders/actions
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ persistence/logs   │
│ telegram alerts    │
└────────────────────┘
```

### Philosophy

Strategies do **not** talk to Hyperliquid directly.
Strategies emit typed intents.
The **risk engine** decides whether those intents are allowed.
The **execution engine** is the only layer allowed to touch exchange writes.

That separation is the whole point.

---

## 🧠 First strategy: `trend-pullback-v1`

The first serious strategy for Vanta is a **trend-following pullback system** for liquid perp markets.

### Thesis

Trade only when higher-timeframe direction is clear, then enter on lower-timeframe pullbacks with structure, volatility, and execution filters.

### Initial market focus

* ₿ BTC
* Ξ ETH
* ◎ SOL

### Core ideas

* filter for clean directional regimes
* avoid chop and tangled EMAs
* enter only on pullback + reclaim behavior
* use maker-first execution when possible
* place real invalidation stops
* take partials, then trail runners
* respect funding and spread/slippage filters

### What it is **not**

* ❌ martingale
* ❌ revenge trading
* ❌ random indicator soup
* ❌ “AI says buy” magic
* ❌ averaging down losers

---

## 🛡️ Risk philosophy

Vanta is built around the idea that **risk is the actual strategy**.

### Mandatory controls

* max concurrent positions
* max notional per market
* max portfolio directional bias
* leverage caps by market
* required stop logic for every entry
* daily drawdown stop
* rolling loss cooldown
* stale-state guard
* slippage/spread guard
* reconciliation gate after disconnects/restarts

### MVP margin stance

Vanta uses **Cross Margin only** in the MVP.

Why? Because isolated margin pool management adds complexity and liquidation risk that is not worth taking in the first production pass.

---

## 📲 Telegram control plane

Telegram is the first control surface because it is fast, secure, and practical for a private VPS bot.

### Notifications

* startup / shutdown
* fills
* rejects / execution errors
* health and heartbeat alerts
* reconciliation mismatch alerts
* daily PnL summaries
* strategy disable alerts

### Commands

```text
/status
/positions
/orders
/pnl
/risk
/pause
/resume
/disable <market>
/enable <market>
/flatten <market>
/flatten_all
/reconcile
/help
```

### Security rules

* Telegram user allowlist only
* no arbitrary shell access
* no direct eval from messages
* privileged actions must be guarded

---

## 💾 Persistence and replay

Hyperliquid does not provide infinite candle history, so Vanta records its own market and execution history locally.

That means:

* 📦 market data gets recorded
* 🧾 order/fill state gets recorded
* 📉 PnL snapshots get recorded
* 🔍 strategy decisions can be replayed
* 🧪 offline analysis and backtesting become possible

This is not optional. It is core infrastructure.

---

## 🔌 Why `@nktkas/hyperliquid`

Vanta is designed around the `@nktkas/hyperliquid` TypeScript SDK because it provides a strong fit for:

* strict typing
* exchange integration in Node.js
* easier agent-assisted development
* cleaner evolution of execution code
* less guesswork than hand-rolled raw request layers

---

## 🧪 Development workflow

### Modes

* **dry-run** → strategies run, no real order writes
* **paper** → simulated execution path
* **testnet** → real exchange integration on HL testnet
* **mainnet** → only after soak testing and operator approval

### Process model

* use **systemd** for long-running services on Ubuntu
* use **crontab** only for backups, reports, maintenance jobs
* use structured logs everywhere
* always reconcile on startup

---

## 📂 Planned repo layout

```text
vanta-hl/
├─ AGENTS.md
├─ LOG.md
├─ README.md
├─ package.json
├─ tsconfig.json
├─ .env.example
├─ src/
│  ├─ app/
│  ├─ config/
│  ├─ core/
│  ├─ exchange/
│  ├─ marketdata/
│  ├─ portfolio/
│  ├─ risk/
│  ├─ strategies/
│  ├─ intents/
│  ├─ telegram/
│  ├─ persistence/
│  ├─ services/
│  └─ cli/
├─ config/
│  ├─ markets/
│  └─ strategies/
├─ scripts/
└─ tests/
```

---

## 🚀 MVP target

The first serious deliverable is:

> a **testnet-only Vanta bot** that can connect to Hyperliquid, ingest market data, persist state, run one pluggable strategy on liquid perp markets, place/manage orders with TP/SL, expose Telegram monitoring commands, and recover cleanly after restart.

That is the correct foundation.

Not dashboards first.
Not SaaS first.
Not fake AI first.
Foundation first.

---

## 🗺️ Roadmap

### Phase 1 — foundation

* project scaffold
* env/config validation
* testnet connectivity
* websocket subscriptions
* market data logging

### Phase 2 — exchange state

* asset registry
* account mirror
* order mirror
* reconciliation flow
* order state machine

### Phase 3 — execution

* place / cancel / modify orders
* leverage updates
* TP/SL support
* dead-man switch integration
* dry-run mode

### Phase 4 — risk engine

* sizing
* exposure controls
* drawdown controls
* cooldown logic
* spread/slippage guards

### Phase 5 — strategy runtime

* plugin contract
* market-to-strategy mapping
* `trend-pullback-v1`
* replay runner
* paper runner

### Phase 6 — Telegram ops

* alerts
* operator commands
* pause/resume/flatten controls

### Phase 7 — hardening

* reconnect tests
* restart recovery tests
* soak testing on testnet
* systemd deployment units

### Phase 8 — mainnet readiness

* smallest size only
* liquid markets only
* one proven strategy at a time

---

## ⚠️ Important notes

### This is a private operator bot

Vanta is intentionally designed for a single operator first.
It is **not** a copy-trading SaaS or public bot platform in the MVP.

### AI is a tool, not the trader

Codex, OpenClaw, Gemini, and similar agents can help build, analyze, refactor, and suggest improvements.
They do **not** get to bypass the live execution and risk path.

### Mainnet is earned

If the bot has not survived testnet soak, restart recovery, reconciliation edge cases, and realistic logging/alerts, it is not ready.

---

## 🧾 Operator workflow

```text
Research → Config/Code Update → Testnet Validation → Soak Run → Review Logs/Metrics → Mainnet Tiny Size → Iterate
```

That loop is how Vanta improves.

---

## 🗡️ Why the name “Vanta”

**Vanta** suggests:

* dark, stealthy execution
* minimal surface noise
* high signal focus
* disciplined operator tooling

Not loud.
Not gimmicky.
Just sharp.

---

## 🤝 Contributing

This repo is optimized for disciplined, operator-driven development.

If you work on it:

* respect module boundaries
* do not bypass the risk engine
* keep strategy files isolated
* update `LOG.md`
* leave the system easier to reason about than you found it

---

## 📜 Disclaimer

This software is for research, engineering, and private operator use. Trading derivatives is risky. Losses can exceed expectations quickly if execution, leverage, or risk controls are misused.

Use testnet first.
Use tiny size first.
Assume the market owes you nothing.

---

## 🖤 Vanta

```text
[ signal ] → [ intent ] → [ risk ] → [ execution ] → [ audit ]
```

**Build it clean. Trade it small. Earn the right to scale.**
