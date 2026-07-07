# ChainSonar — requirements for Athena (Studio build)

> **Dual-development brief.** This is the Track-1 artifact: the requirements the
> operator (Claude, via the test-automation harness on `:17320`) feeds to Athena
> in **Studio** (the `webbuild` "Athena web-dev companion") to build a chain
> trade-signal app. The paired Track-2 artifact — observing and hardening the
> Studio *feature* as it builds — lives in [`studio-hardening-log.md`](./studio-hardening-log.md).
>
> Studio scaffolds a **Next.js + TypeScript + Tailwind** app (Bun) and each chat
> turn is a real project-rooted `claude` coding turn. See
> `docs/concepts/web-build-best-practices.md` (the build doctrine) and
> `docs/features/companion/athena-guided-walkthroughs.md` for the surrounding
> feature.

## The product in one line

**ChainSonar** — a local, **read-only** research desk for spotting and *vetting*
low-market-cap Ethereum (ERC-20) tokens **before** any real trading: is this a
trap, and is there a real, improving opportunity — then define entry/exit rules
and **backtest + paper-trade** them against on-chain data.

## Hard safety boundary (v1) — non-negotiable

- **Read-only + paper only.** No wallet connect, no private keys, no transaction
  signing, no real orders, no fund movement. Any "trade" is a virtual
  (paper/backtest) trade in a local ledger.
- **Local-first.** No credential leaves the machine; an RPC key (if the user adds
  one) lives in `.env.local`, read server-side only, never shipped to the client.
- This mirrors the user's framing: *theoretical test trades … before real
  automated trading.* Real-trading plumbing is explicitly **out of scope** for v1.

## S1 brief (the shape the doctrine wants)

- **Audience:** a hands-on crypto trader who researches micro-caps and is tired of
  getting rugged.
- **Primary goal:** given a token address (or a watchlist), answer two questions —
  **(a) is this a trap?** (rug / honeypot / mint / owner risk) and **(b) is there a
  real, improving opportunity?** — then let them **backtest + paper-trade** rules.
- **Secondary goals:** a persistent watchlist scoreboard; a per-token safety report
  card; price/holder charts; a paper portfolio with PnL.
- **Project type:** *useful web app* (persistence = **yes**) — a data/analytics
  tool, **not** a marketing site. The data pipeline and analytics ARE the product.
- **Tone:** precise, trustworthy, fast, data-dense; dark, terminal/Bloomberg-like.
- **Hard constraints:** the safety boundary above; RPC-direct data; graceful
  handling of RPC failure/rate-limits (first-class empty/loading/error states).

## The vision seed (verbatim — this is fed to `createWithVision`)

> Build **ChainSonar** — a local, read-only research desk for spotting and vetting
> low-market-cap Ethereum (ERC-20) tokens BEFORE any real trading. It is a
> data/analytics tool, not a marketing site: the data pipeline and the analytics
> ARE the product, so prioritize a correct, resilient pipeline and clear, dense,
> legible analytics over hero/brand flourish (still hold a high visual bar — think
> a Bloomberg-terminal-grade tool, not a landing page).
>
> Audience: a hands-on crypto trader who researches micro-caps and is tired of
> getting rugged. Primary goal: given a token (address) or a watchlist, tell them
> (a) is this a trap? (rug/honeypot/mint/owner risk) and (b) is there a real,
> improving opportunity here? — then let them define entry/exit rules and BACKTEST
> + PAPER-TRADE those rules with a virtual portfolio. No wallet, no private keys,
> no signing, no real orders — read-only + paper only. Tone: precise, trustworthy,
> fast, data-dense (dark, terminal-like).
>
> Data: pull on-chain data DIRECTLY over Ethereum JSON-RPC. Reach the RPC through a
> Next.js route handler (server-side) so the browser never hits CORS/rate limits or
> leaks a key; read the endpoint from `process.env.ETH_RPC_URL` with a sensible
> public mainnet default and document adding an Alchemy/Infura key in `.env.local`.
> Use **viem** for RPC/ABI calls — install it. From RPC derive: ERC-20 metadata
> (name/symbol/decimals/totalSupply), the token's main Uniswap v2/v3 pool + price
> from reserves/slot0, holder set + concentration from Transfer logs, and
> contract-safety facts (has code, `owner()`/renounced, mint capability, LP
> burned/locked, transfer-tax/blacklist heuristics). Produce a composite SIGNAL
> score (momentum + liquidity/holder growth) and a SAFETY score (risk flags) per
> token; be HONEST when a check can't be done over RPC alone (flag "unknown", don't
> fake it).
>
> Persistence: yes — a watchlist, cached token data, and the paper-trade portfolio
> + trade ledger survive reloads (localStorage is fine for v1; a small SQLite via a
> route handler is welcome for the ledger). Because it's a real app, empty/loading/
> error states are first-class (RPC calls fail and rate-limit — handle it
> gracefully and show it).
>
> Start with the foundation + the core data flow: a token lookup by address that
> fetches metadata + price + a safety report card from RPC and renders it. Then the
> watchlist scoreboard, then the rule/backtest/paper-trade engine, then charts.
> I'm calling it **ChainSonar** for now — confirm or rename it, and confirm the v1
> feature scope, before building around them.

## Decision playbook (pre-answers to Athena's `NEEDS_INPUT`)

Answer fast and consistently. When Athena asks, respond with the matching value.

| Athena is likely to ask | Answer |
| --- | --- |
| Product **name** | **ChainSonar** (keep). |
| v1 **feature scope** / what ships | Token lookup + safety report card; persistent watchlist scoreboard; rule builder + backtest + paper-trade portfolio/ledger; price + holder-distribution charts. **Defer:** multi-chain, real trading, alerts/push, user accounts, paid indexers. |
| Which **chain(s)** | Ethereum **mainnet only** for v1. |
| RPC provider / do I have a key? | Public mainnet RPC default; **don't block** on a key — user adds Alchemy/Infura in `.env.local` later. **Verified-working no-key default: `https://ethereum-rpc.publicnode.com`** (also good: `eth.merkle.io`, `1rpc.io/eth`, `eth.drpc.org`). Avoid `eth.llamarpc.com` (was down / CF 521 on 2026-07-05). Pinned live via `chainsonar/.env.local` → `ETH_RPC_URL`. |
| How to **discover** low-cap tokens | v1: user-pasted **watchlist** + optional scan of recent Uniswap `PairCreated`/`PoolCreated` events. Defer a paid indexer. |
| **Price** source | Derive from the token's main **Uniswap** pool via RPC (reserves / slot0). A free API (DexScreener/GeckoTerminal) proxied server-side is an acceptable augment later. |
| **Storage** | `localStorage` for watchlist/portfolio in v1; **SQLite** via a route handler is welcome for the trade ledger. |
| **Design / theme** | Dark, terminal/Bloomberg-like, data-dense, high-contrast, monospaced numerics. (Low-stakes — decide it yourself; this is the direction if asked.) |
| **Risk thresholds** (what is "safe") | Defaults, all **tunable**: liquidity ≥ ~$25k; top-10 holders < 60%; LP burned or locked; ownership renounced OR no mint function; token age ≥ a few days. Heuristics — surface them, don't hardcode-hide them. |
| Real **content/copy** | It's a tool — minimal marketing copy. Use a real, well-known token address for the demo/empty state. |

**Golden rules while driving:** make all low-stakes/technical calls for Athena;
only escalate a decision to the user (real person) if it's genuinely product-
defining and not covered above. Log every decision + answer in the hardening log.

## Data architecture (target)

- **RPC proxy:** Next.js route handler(s) under `app/api/rpc/*` (or a viem
  transport on the server) — the browser calls our routes, the route calls
  `ETH_RPC_URL`. Keeps keys server-side and sidesteps CORS/rate-limits.
- **On-chain reads (viem):** ERC-20 `name/symbol/decimals/totalSupply/balanceOf`;
  Uniswap v2 `getReserves` / v3 `slot0` for price; `eth_getLogs` on `Transfer` for
  holders + flow; `getCode`/`owner()`/mint-selector probes for safety.
- **Scores:** `signalScore` (momentum + liquidity growth + holder growth) and
  `safetyScore` (risk-flag penalties). Both explainable — show the components.
- **Backtest:** reconstruct a price series from swap events over a window; run the
  user's rule; report entries/exits/PnL/drawdown.
- **Paper trade:** apply rules to live-polled data into a virtual portfolio +
  ledger (persisted). No real orders, ever.

## Milestones

- **M1 — Foundation + core data flow.** Themed dark terminal shell; RPC route
  handler w/ `ETH_RPC_URL` + viem; **token-lookup-by-address → metadata + pool
  price + safety report card**; empty/loading/error states.
- **M2 — Watchlist + scoreboard + scoring.** Add/remove tokens (persistent);
  signal + safety scores; sortable scoreboard.
- **M3 — Rules + backtest + paper-trade.** Rule builder; historical series from
  swaps; backtest results; paper portfolio + ledger + PnL.
- **M4 — Charts + polish.** Price/volume + holder-distribution charts; per-token
  detail; responsive; self-critique pass.

## Honesty guardrails (so "high probability of success" stays real)

- Micro-caps are adversarial (honeypots, hidden mints, rug pulls). ChainSonar's
  edge is **avoiding losers** as much as finding winners — the safety card is a
  first-class output, not a footnote.
- Never present a heuristic as a guarantee. Every score shows its inputs; every
  un-checkable fact is flagged **unknown**, not green.
- Backtest results are hypotheses, not promises — label them as such in the UI.
