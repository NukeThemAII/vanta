# Vanta Operator Setup Guide

This guide covers what you need to do on your side to get Vanta ready for Hyperliquid testnet execution.

It covers:
- what wallet/key roles Vanta expects
- how to generate a private key locally
- how Hyperliquid testnet funding works
- where to put the values in Vanta config
- what commands to run to verify the setup

## 1. Understand the two wallet roles

Vanta currently expects two distinct identities for write-side execution:

1. `VANTA_OPERATOR_ADDRESS`
   This is the Hyperliquid account address that owns the funds and positions.

2. `VANTA_API_WALLET_PRIVATE_KEY`
   This is a separate API wallet private key used only for signing write actions.

Important:
- The operator/master account holds the funds.
- The API wallet does not need funds.
- The API wallet must be approved by the operator/master account before it can sign on its behalf.
- For reads, Vanta must use the operator address, not the API wallet address.

That matches the Hyperliquid docs: API wallets sign, while account queries must use the actual master/subaccount address.

## 2. What you need before Vanta can place testnet orders

You need all of the following:

1. A main/operator wallet address you control.
2. That same address available on Hyperliquid testnet.
3. Mock USDC on testnet for that operator address.
4. A separate API wallet private key generated locally.
5. The API wallet approved by the operator account.
6. A local `.env` file in this repo with the correct values.

## 3. Important testnet funding rule

Hyperliquid testnet faucet is not fully open.

According to the official docs:
- you must have deposited on mainnet with the same address
- then you can claim testnet mock USDC from the faucet

Official faucet page:
- https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet

Faucet app:
- https://app.hyperliquid-testnet.xyz/drip

What this means in practice:
- if your operator wallet has never deposited on Hyperliquid mainnet, the faucet may not work
- the API wallet does not need faucet funds
- the operator/master wallet is the address that matters for testnet funding

## 4. Generate an API wallet private key locally

Do this locally on your machine. Do not paste the private key into chat.

### Option A: generate with OpenSSL

```bash
openssl rand -hex 32
```

That returns 64 hex characters. Add `0x` in front of it when you put it in `.env`.

Example:

```text
0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

### Option B: generate with Node

```bash
node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
```

## 5. Get the API wallet public address from the private key

You need the public address of the API wallet so the operator account can approve it.

You can derive it locally with `viem`, which is already in this repo:

```bash
node --input-type=module -e "import { privateKeyToAccount } from 'viem/accounts'; const pk = process.argv[1]; console.log(privateKeyToAccount(pk).address);" 0xYOUR_PRIVATE_KEY
```

This prints the API wallet address.

## 6. Approve the API wallet on Hyperliquid

Hyperliquid calls API wallets `agent wallets` in the docs.

Relevant official docs:
- Nonces and API wallets:
  https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets
- Exchange endpoint / approveAgent:
  https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint

What you need to do:

1. Log into Hyperliquid with your operator/master wallet.
2. Approve the API wallet address you generated.
3. Keep the operator wallet private key separate from the API wallet private key.

Operational rule for Vanta:
- one API wallet per trading process
- do not casually reuse the same signer across multiple independent writers

## 7. Fund the operator address on testnet

The operator address is the account that needs testnet funds.

Steps:

1. Open the testnet faucet:
   `https://app.hyperliquid-testnet.xyz/drip`
2. Connect the same operator wallet address you intend to use as `VANTA_OPERATOR_ADDRESS`.
3. Claim mock USDC.
4. Confirm the balance is visible on Hyperliquid testnet.

If the faucet does not work:
- verify this exact address has deposited on Hyperliquid mainnet before
- verify you are not accidentally using a different address on testnet

The docs explicitly warn that some email-login flows can create a different wallet on testnet vs mainnet. If you use email login, export/import the wallet so you control the same address on both sides.

## 8. Create your local `.env` file

Vanta reads config from environment variables. The simplest setup is to create a `.env` file in the repo root.

Start from the example:

```bash
cp .env.example .env
```

Then edit `.env` and set at minimum:

```dotenv
VANTA_APP_ENV=development
VANTA_NETWORK=testnet
VANTA_LOG_LEVEL=info
VANTA_SQLITE_PATH=./data/vanta.sqlite
VANTA_MARKETS=BTC,ETH

VANTA_OPERATOR_ADDRESS=0xYOUR_OPERATOR_ADDRESS
VANTA_API_WALLET_PRIVATE_KEY=0xYOUR_API_WALLET_PRIVATE_KEY
VANTA_VAULT_ADDRESS=
VANTA_BOOTSTRAP_USER_STATE=true
```

Notes:
- `VANTA_OPERATOR_ADDRESS` is your funded Hyperliquid testnet account.
- `VANTA_API_WALLET_PRIVATE_KEY` is the separate signer key.
- leave `VANTA_VAULT_ADDRESS` empty unless you are intentionally trading through a vault/subaccount path.

## 9. Verify the config before any write test

Run read-side checks first:

```bash
corepack pnpm typecheck
corepack pnpm build
corepack pnpm reconcile:run
corepack pnpm state:risk
```

You want to see:
- valid config loading
- successful reconciliation
- `trustState` becoming `trusted`

## 10. Run the first controlled write-side smoke test

Only do this after:
- the operator address is funded on testnet
- the API wallet is approved
- reconciliation is healthy

Then run:

```bash
corepack pnpm smoke:execution --allow-write-actions --market BTC --side buy --cancel-mode cloid
```

Optional flags:

```bash
corepack pnpm smoke:execution --allow-write-actions --market BTC --side buy --cancel-mode cloid --skip-modify
corepack pnpm smoke:execution --allow-write-actions --market BTC --side buy --cancel-mode order-id
corepack pnpm smoke:execution --allow-write-actions --market BTC --side buy --cancel-mode cloid --schedule-cancel-ms 30000
```

This is still a smoke test, not production trading.

## 11. Where exactly the secret goes

The only secret Vanta needs right now is:

```dotenv
VANTA_API_WALLET_PRIVATE_KEY=0x...
```

Put it in your local `.env` file at repo root.

Do not:
- commit it to git
- paste it into chat
- send it to me
- put the operator/master private key there unless you explicitly intend to use the master wallet itself as signer, which is not the safer operational model

## 12. Can you give the private key to me to configure it?

Technically you could paste it, but you should not.

My recommendation is:
- do not send private keys in chat
- create/edit `.env` locally yourself
- if you want, I can help you verify the format and exact variable names without seeing the secret

Safe way to work with me:
- you create `.env` locally
- you run the commands
- if there is an error, paste the error output only

If you want me to configure the file structure for you without seeing the secret, I can also prepare:
- a `.env` template
- a `testnet.env.example`
- validation checks for missing/invalid values

## 13. Minimal checklist

Before asking Vanta to place a testnet order, confirm:

1. Operator wallet exists and you control it.
2. Operator wallet has testnet mock USDC.
3. API wallet private key was generated locally.
4. API wallet address was approved by the operator account.
5. `.env` contains:
   - `VANTA_OPERATOR_ADDRESS`
   - `VANTA_API_WALLET_PRIVATE_KEY`
6. `corepack pnpm reconcile:run` succeeds.
7. `corepack pnpm state:risk` shows trusted runtime state.
8. Only then run `corepack pnpm smoke:execution --allow-write-actions ...`

## 14. If you want the fastest next move

Do this next:

```bash
cp .env.example .env
```

Then fill in:
- `VANTA_OPERATOR_ADDRESS`
- `VANTA_API_WALLET_PRIVATE_KEY`

Then run:

```bash
corepack pnpm reconcile:run
corepack pnpm state:risk
```

If those are clean, run:

```bash
corepack pnpm smoke:execution --allow-write-actions --market BTC --side buy --cancel-mode cloid
```
