# Ship Loop — Value & Market Case (Milestone 6)

_Dimension 9 (Value & market) — the last red cell on the scorecard. Synthesized 2026-07-04 from three parallel investigations: competitor landscape (web-researched), per-feature value + subscription economics, and the cold-start journey. Ship bar in force: **distributable beta** (a colleague can install + auto-update)._

---

## Verdict (one screen)

**Ship the beta — but ship a narrower product than the app currently presents.** The value thesis is real and defensible; the surface area is 2–3× wider than the value, and the widest parts are the least ready. The single highest-leverage pre-beta change is not a feature — it's making the **CLI-subscription value legible in the first five minutes** and cutting the demo-grade surfaces out of the beta's first impression.

- **Dimension 9 → 🟡** (was 🔴). It's not 🟢 because the value is proven on paper and in the code, not yet in a real cold-start user's hands — item 44's frictions (below) sit directly between install and "first personally-relevant artifact."
- **The moat is economic, not technical.** Personas runs Claude through the user's existing Claude Code **subscription** (no API keys, no per-token billing), which is a **3–10× cost advantage** over any competitor that bills the Anthropic API. That is the whole reason to exist. Everything that doesn't reinforce it is a distraction in a beta.
- **The existential risk is first-party.** Anthropic shipping native scheduled tasks / routines / teams inside the same subscription would collapse the wedge. This argues for shipping *now*, while the gap is open, and for staying on the "orchestration + observability + local-first vault" ground that a first-party feature is least likely to cover first.

---

## 1. Competitor landscape (item 43)

The exact four-way intersection Personas occupies — **local-first desktop × subscription-billed execution × scheduled autonomous non-coding agents × observability** — is genuinely thin. Each competitor overlaps on one or two axes, none on all four.

| Competitor | Overlap with Personas | Where they bill | Threat | Why |
|---|---|---|---|---|
| **Anthropic first-party** (scheduled tasks / routines / Claude teams) | Same subscription, same model, same "delegate work to Claude" job | Subscription (theirs) | **Existential** | If they ship cron + multi-agent in-subscription, the wedge closes. Can't out-Anthropic Anthropic on the model; can only win on local-first data custody, cross-provider orchestration, and depth of observability. Ship before they do. |
| **OpenClaw** (open-source Claude-Code fleet manager) | Fleet/multi-session orchestration of Claude Code | Free / self-host | **High** | Directly targets the "manage many Claude sessions" job Fleet does. Open-source and free — competes on price-of-zero. Personas must win on the non-coding agent surface (triggers, vault, observability, templates) they don't have. |
| **n8n** (workflow automation, self-hostable) | Scheduled/triggered automation, local-first option | Free tier + self-host + cloud | **High** | The incumbent "cron my automations" tool. Broad connector catalog. Personas' edge = it's Claude-native and subscription-billed, not a generic node graph you wire an API key into. |
| Dev-agent tools (Cursor background agents, Devin-likes, Claude Code itself) | Autonomous agents | Mostly free or subscription | Medium | Pricing is **hostile** — the coding-agent category trends to free/bundled. Personas must stay OUT of the "another coding agent" framing; its non-coding scheduled-agent surface is the differentiation. |
| Zapier / Make / Pipedream | Scheduled triggers + integrations | Per-task/per-run SaaS | Low–Medium | Not Claude-native, no local vault, per-run billing. Personas' subscription economics undercut them for LLM-heavy flows. |

**Demand signal is real.** "Cron my Claude subscription" is a stated want in the wild — projects like *runCLAUDErun* and assorted "schedule Claude Code" scripts exist precisely because the first-party product doesn't do it yet. Personas is a productized, observable, vault-backed answer to a need people are currently hacking together. That validates the wedge **and** dates it: the same demand is what pulls Anthropic toward closing it.

**Positioning takeaway for the beta:** lead with *"schedule and orchestrate your Claude subscription to do real work while you're away — with your credentials staying on your machine."* Do **not** lead with "AI agent platform" (crowded, undifferentiated) or anything that reads as "another coding agent" (race to free).

---

## 2. Per-feature value × readiness (item 43)

Scored on two axes: **value carried** (does it advance the subscription-orchestration thesis?) and **beta readiness** (would a colleague hit a wall?).

| Feature | Value | Readiness | Verdict |
|---|---|---|---|
| **Execution engine on the subscription CLI** | ⭐⭐⭐ Core | 🟢 Solid | **The product.** force_subscription_auth verified across all 15 spawn sites. The moat — protect and foreground it. NOTE: the cost *advantage* is NOT currently computed in-app (parser.rs:259 only reads the CLI's own reported `total_cost_usd`); making it legible is an unbuilt opportunity, not an existing feature (see §3, §4). |
| **Fleet + Athena** (multi-session orchestration + companion) | ⭐⭐⭐ High | 🟡 Good | The "orchestrate many Claudes" story OpenClaw is chasing. Strong. Ship it — it's a headline, not a footnote. |
| **Builder + templates + vault** (persona authoring, credential custody) | ⭐⭐⭐ High | 🟡 Good (one cold-start trap) | Local-first AES-256-GCM vault is a real local-first differentiator. BUT the template picker is empty on fresh boot (see §3) — the readiness gap is onboarding, not the feature. |
| **Triggers / schedules** | ⭐⭐⭐ High | 🟡 Mixed | This IS the "cron my subscription" wedge. The Chain Studio commit path was just wired (M5, 874628340) — but the patchbay still carries ~23 TODOs. Core scheduling works; the visual composer is beta-rough. Ship scheduling; label the composer "beta". |
| **Observability / overview** | ⭐⭐ Medium-High | 🟡 Good | Reinforces the wedge (you can SEE what your subscription did overnight). Keep. |
| **Teams / collaboration** | ⭐ Low (today) | 🔴 **Demo-grade** | Presents as a shipping feature; is closer to a demo. **De-emphasize or hide in the beta** — a colleague poking it finds the thinnest ice. |
| **Twin** | ⭐ Speculative | 🔴 Unproven | Interesting bet, no evidence of the job it does. **Cut from the beta's first impression;** keep behind a flag. |
| **Studio patchbay (visual chain composer)** | ⭐⭐ Medium | 🔴 ~23 TODOs | The commit path works now; the surrounding composer is unfinished. **Label "beta"** and don't put it on the happy path. |

**Cut / de-emphasize for the beta (3 weakest):** Teams (demo), Twin (speculative), Studio patchbay polish (unfinished). None are load-bearing for the value thesis; all three are where a colleague's trust breaks first. Hiding them *raises* the beta's perceived quality.

**Carry loud (3 strongest):** subscription-CLI execution engine, Fleet+Athena, Builder+templates+vault. These three, plus scheduled triggers, ARE the beta.

---

## 3. Subscription economics — the actual math

The differentiator, quantified. Personas spawns the user's Claude Code CLI, which authenticates against their **existing Claude subscription** (Pro/Max/Team). Competitors that call the Anthropic API pay **per token**. For the autonomous-agent job — many scheduled runs, long context, repeated overnight — the delta compounds:

- **Subscription:** flat monthly cost, already sunk. Marginal cost of the 100th scheduled run this month ≈ **$0** (until rate limits).
- **API:** every run bills input + output tokens. A single agentic run with tool-use and a large context routinely lands in the dollars; a fleet of them, nightly, is a real bill.
- **Advantage: ~3–10×** depending on run shape (higher for long-context, tool-heavy, high-frequency).

**Reality check (verified 2026-07-04 against the code):** the app does **not** currently compute or surface this advantage. `parser.rs:259` only extracts the `total_cost_usd` the Claude CLI itself reports; it's displayed as a raw "Total Cost" tile. A separate `estimateCost` (pricing.ts) does API-rate math for a single execution's cost breakdown, but nothing anywhere frames a subscription-vs-API *comparison* or a "saved vs API" figure. So the moat is real in economics but **invisible in the product** — the user never sees the number that is the reason to stay.

There's also an honesty landmine to respect when we DO surface it: in subscription mode `total_cost_usd` is *itself* an API-rate estimate the CLI computes, so a naive "you saved $X" would double-count. The correct framing is "this run would have cost ≈$X billed against the API; on your subscription it's included" — a reframe of the same number, not a second computation stacked on top.

This is why the moat is economic. A competitor can copy every feature; they cannot copy "runs on the subscription you already pay for" without Anthropic's cooperation — which is exactly the first-party risk. **The beta's job is to make a user FEEL the ~3–10× in week one**, and today it can't, because the number isn't surfaced. That makes "surface the cost-advantage figure" not a polish item but a core-value-legibility item (see §4).

---

## 4. Cold-start journey (item 44)

Path traced: fresh install → first personally-relevant artifact. **~10–15 minutes, ~7 decisions, 2 real CLI runs — *conditional on the CLI being installed and logged in.*** That condition is the whole ballgame.

### The frictions, ranked

1. **Subscription login is never proactively probed; CLI-presence is only checked passively.** _(refined against code 2026-07-04.)_ CLI *presence* IS surfaced — but only on the Home page's SystemHealthPanel (`health.rs:354-421` probes `claude/claude.cmd/claude.exe/claude-code`), a non-blocking status card the user has to happen upon. **Subscription login is probed nowhere at startup.** The one code path that would reveal a logged-out CLI (`cli_capabilities::get_or_probe`, spawns `claude -p`) is invoked from exactly one place — a persona-editor toggle — never at boot. So a logged-out or missing-CLI user discovers it only when their first real run fails and gets post-hoc classified ("Credit balance too low" / not-found). **This is the #1 first-impression killer** — the thing that makes the value real is the thing the app never confirms before the first failure.
2. **Template picker is EMPTY on fresh boot** _(confirmed, with nuance)._ Two distinct empties: (a) the **trending shelf** renders `null` whenever `adoption_count = 0` (`TrendingCarousel.tsx:22` + `reviews.rs:654` `WHERE adoption_count > 0`) — always empty until the community has adopted; (b) the **onboarding template-picker** lands in its `'empty'` phase on a truly fresh DB, because seeding runs only inside the Templates-page mount effect (`useDesignReviews.ts:137`) and the onboarding fallback (`listDesignReviews`) returns nothing if the user reaches onboarding before ever opening Templates. The full gallery grid *does* self-seed on its own mount — so the real gap is specifically the trending shelf + the onboarding picker, the two surfaces a brand-new user hits first.
3. **Logged-out CLI is undetected** — folds into #1 (same missing proactive probe): even an installed CLI that's logged out fails opaquely instead of saying "run `claude` once to log in."
4. First-run has no zero-credential "instant win" surfaced, even though **five zero-connector quick-win templates exist** (verified `"connectors": []`): Scientific Writing Editor, Website Conversion Audit (the *marketing* one — the *sales* "Website Conversion Auditor" needs browser+messaging connectors, don't confuse them), Daily Standup Compiler, Vault-Grounded Journal Coach, Research Paper Indexer. None is foregrounded — the onboarding fallback takes an arbitrary first-3 with no zero-cred ordering.

### Recommendations (sized)

- **[M] Startup CLI + login probe with a first-run gate.** On boot (or first-run), reuse `cli_capabilities::get_or_probe` (already spawns `claude -p`, so a missing binary OR a logged-out/credit-exhausted session is detectable there) and surface a single clear gate — "Personas runs on your Claude subscription; install/log in the Claude CLI to continue" — instead of letting the first run fail. Kills frictions #1 and #3 together. **Highest-ROI change in the milestone.** Sized M not S (per code review): must not block first paint and adds a boot-time `claude` spawn — do it async behind the first-run flow, not on the critical render path.
- **[S–M] Guarantee a non-empty picker for new users.** Cheapest: elevate seeding out of the Templates-page mount into an app-init effect so the onboarding picker + gallery are populated regardless of navigation order, and give the trending shelf a "Starter" fallback (curated zero-cred set) when `adoption_count = 0` everywhere. Heavier alt: port the catalog to a Rust compiled-in seeder (boot-time, offline-safe) — larger, must preserve the checksum-verification path. Kills friction #2.
- **[S] Foreground a zero-credential quick-win on first run.** Presentation-only: order the onboarding fallback (`useOnboardingState.ts:190`) by the already-present `connectors: []` flag so a brand-new user's *first* suggested artifact needs no vault setup — value before configuration. Data's already there; this is the lowest-risk fix of the four. Kills friction #4.
- **[S–M] Surface the cost-advantage figure — carefully.** Per §3 this is NOT wiring up an existing number; it's a new comparison the app doesn't compute today. Reframe the CLI's `total_cost_usd` as "≈$X if billed against the API — included on your subscription" (a reframe, NOT a second computation stacked on `estimateCost`, or you double-count). Touch `CostBreakdownBar.tsx` + an SLA/observability tile + i18n ×14. This is the single change that makes the economic moat legible in week one.

**These four are the item-44 deliverable and they are, not coincidentally, the highest-value pre-beta work in the whole loop** — they sit on the critical path between "installed" and "understood the point." Sizes revised against the real code: the startup probe is M (boot-latency care), the zero-cred foregrounding is the cheapest S, and the cost-figure needs an honesty decision (see §3 landmine) that is genuinely the user's product call.

---

## 5. Week-one production-reality checklist

Things a real beta user hits in the first session that the tour never exercises (from the per-feature investigation):

1. **No proactive subscription-login probe at startup** (CLI *presence* is checked, but only passively on the Home page; login is checked nowhere until a run fails) — see §4 friction #1. _(→ [M] fix above.)_
2. **Template "Ready" overclaim** — templates present as ready before their credential bindings are actually satisfied; a colleague adopts, runs, and hits a wall the badge said wasn't there.
3. **Boot hard-codes `'en'`** — first paint is English regardless of OS locale until the persisted locale loads; non-English colleagues get an English flash (cosmetic, but a first-impression tax).
4. **Empty template picker on fresh boot** — see §4 friction #2.
5. **Logged-out CLI undetected** — see §4 friction #3.
6. **Teams surface reads as shipped but is demo-grade** — §2; a poking colleague finds thin ice.
7. **Studio patchbay ~23 TODOs** — §2; visual composer is beta-rough behind a working commit path.
8. **Twin is unproven** — §2; speculative surface on the happy path dilutes the beta.

Items 1, 2, 4, 5 are the ones that block "first artifact" and should gate the beta. Items 3, 6, 7, 8 are "narrow the surface / add a beta label" — presentation, not blockers.

---

## 6. CP6 — decisions for the user

The value lens produces four product decisions (not code changes yet — the loop asks before executing). Framed as the last checkpoint:

- **CP6-a — Beta scope.** Ship the three strong surfaces loud (execution engine, Fleet+Athena, Builder+templates+vault + scheduling) and *narrow* the first impression by hiding/flagging the three weak ones (Teams, Twin, Studio patchbay polish)? Or ship everything visible and accept the thin-ice risk?
- **CP6-b — Cold-start fixes as M7.** The four §4 recommendations (startup CLI/auth probe [S], seed-templates-at-boot [S], zero-credential first win [M], cost-number surfacing [M]) are the highest-leverage remaining work. Make them the next milestone?
- **CP6-c — Positioning.** Adopt the "schedule & orchestrate your Claude subscription, credentials stay local" framing over "AI agent platform"?
- **CP6-d — First-party risk posture.** Ship the beta *now* to exploit the open gap, treating Anthropic-native scheduling as the clock we're racing?

---

## Scorecard delta

| Dim | Before M6 | After M6 |
|---|---|---|
| 9 · Value & market | 🔴 (lens not run) | 🟡 (value proven on paper + in code; cold-start frictions between install and first artifact keep it off 🟢 until item-44 fixes land) |

**Path to 🟢:** land the four cold-start fixes (CP6-b) → a fresh install reaches first personally-relevant artifact without hitting an invisible prerequisite → run the value journey (item 44) live to confirm. That's the last mile of dimension 9.

---

## M7 execution plan (code-verified 2026-07-04) — ✅ ALL SHIPPED

**Status: M7 complete.** All four landed as atomic commits, gate green (tsc 0 · lint 0 err · vitest 2029/2029 · build · tours 6/6): Fix#1 `dd6c24ebd` · Fix#2 `82e7a1451` · Fix#3 `40c222018` · Fix#4 `35fa6be38`. Dim 9 🟡→🟢. Remaining spot-check = a live fresh-install getting-started walkthrough (pick-template→adopt→run), which tours-explore doesn't exercise.

Ordered by ROI-per-risk. Each is an atomic commit; full gate at milestone end (frontend script + Rust filtered suites; **tours mandatory** — #1/#2/#3 change onboarding runtime UI). Sizes/citations are from the live-code review, not the lens estimate.

1. **Foreground zero-cred quick-win** — **[S], lowest risk, do first.** Order the onboarding fallback (`src/features/onboarding/components/useOnboardingState.ts:190`) by the already-present `connectors: []` flag; the 5 zero-connector templates become the first suggestion. Presentation-only, data already in the catalog. Onboarding surface → doc-sync touches `docs/features/onboarding.md` + possibly the tour.
2. **Non-empty picker for new users** — **[S–M].** Lift `seedCatalogTemplates` out of the Templates-page mount (`useDesignReviews.ts:137`) into an app-init effect so onboarding picker + gallery populate regardless of nav order; give `TrendingCarousel` a curated "Starter" fallback when `adoption_count = 0` everywhere. Preserve the checksum-verification path in `templateCatalog.ts`. Watch idempotency (re-seed guard).
3. **Startup CLI + login probe / first-run gate** — **[M], highest value.** Reuse `cli_capabilities::get_or_probe` (`src-tauri/src/engine/cli_capabilities.rs:53`) async off the first-run flow (NOT the first-paint critical path); surface a single gate when CLI missing OR logged-out/credit-exhausted. Wire from `src/App.tsx:~199` first-run state, not Rust `setup()` (keep boot fast). New failure surface — needs a tours pass.
4. **Surface the cost-advantage figure** — **[S–M], needs a product-honesty call first.** Reframe `total_cost_usd` (parser.rs:259 → execution rows) as "≈$X if billed to the API — included on your subscription" in `CostBreakdownBar.tsx` + one SLA/observability tile + i18n ×14. **Do NOT stack a second computation on `estimateCost` (pricing.ts) — that double-counts** (see §3 landmine). This is the item where CP6 wants the user's framing decision before code.

Gate/harness reminder: suites first, tours last; pre-warm `.personas-e2e-target` AFTER committing; never run tours concurrent with the full vitest/cargo suites (360s bridge window — bitten twice).
