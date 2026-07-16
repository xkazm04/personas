# UAT L1 Sweep — Synthesis (2026-07-16)

12 journeys, full roster (51 character×journey walks), theoretical/code-grounded only — no live app. Full detail in `report.md`; this is the cross-cutting read.

## Cross-cutting themes

**1. Docs and even in-app character bindings are drifting faster than the product.** Three independent journeys (synthesize-team, build-persona-from-intent, and the context-map references in adopt-template/track-goal-kpi) hit a Character or journey file pointing at a surface that either doesn't exist under that name anymore (Console/Briefing → Timeline/Grid) or doesn't exist at all (`simple-mode`). This isn't a product defect — it's evidence the `/uat update` cadence needs to run *more* often than every ~4 weeks, or drift accumulates faster than expected in a fast-shipping repo. Recommend tightening the update cadence, or wiring `/uat update` into whatever cadence `/guide-sync` uses.

**2. AI-generated content and error messages are not localized, even when the surrounding UI chrome is excellent.** Every journey's *static* i18n coverage checked out clean (100% es parity, no first-paint flash). But the two places that actually matter most to a non-English user — the companion's generated reply text and its error messages — have **zero** locale awareness in the Rust prompt-building or the frontend error-display path. This is a distinct, narrower defect class than "translation gaps" and should be tracked separately from the i18n backlog.

**3. Confirmation/approval gates are real where built, but their scope doesn't match user mental models.** Two separate subsystems (trigger `unattended_mode`, companion `use_connector`) both have working, well-engineered gates — but each covers a narrower slice of the surface than the character (and probably the average user) would assume. The trigger gate protects scheduled/polling fires but not the externally-triggered webhook/event-listener fires that are exactly what an alerting/ops use case needs protected. The companion's connector-calling op is the one category with no gate at all. Recommend a single audit pass across all "does this ever act without asking me" surfaces rather than patching each journey's instance separately.

**4. Silent-but-safe degradation is a recurring near-miss pattern.** Fleet's live-slot cap, Lab's rating honesty, and the vault's audit-gap counter are all cases where the *safety* mechanism is genuinely sound (nothing is silently lost or hidden at the data layer) but the *signal* to the user is passive (a vanished tile, a small badge, a count delta) rather than proactive (a toast, an alert). This is a cheaper class of fix than the underlying reliability work already shipped — worth a dedicated sweep.

**5. Grounding is strong for "read my real state," weak for "remember my preferences."** Every AI-surface grounding audit this run (companion, build-session, adoption) found genuinely real per-user context — live personas, live connectors, live goals, live execution history. None of them found a *persistent, reusable* brand-voice/style memory. The gap isn't "the AI doesn't know about me," it's "the AI has to be re-told the same thing every session" — a product-shaped gap, not an engineering-shaped one.

**6. Governance/buyer-trust surfaces have real structural blockers, not just polish gaps.** Both blockers in trust-and-governance (Network/Admin walled by a dev-flag independent of tier; no pricing anywhere in-product) sit directly in the reachable set of paying customers and prospects, not behind some acceptable dev-only wall. These are the two highest-priority items in this entire sweep because they block a segment (buyer, enterprise-admin) from completing their core job at all, structurally, regardless of live-app behavior.

## Prioritized backlog

**P0 — core-promise blockers (fix before next release cut):**
1. `test-a-tool`: rate-limit and credential-auth failures never reach the typed error contract, and the frontend renders any non-typed failure as literal `[object Object]` — the hand-test panel is currently worse than no diagnostics for its two most likely real failure triggers.
2. `trust-and-governance`: Settings → Network/Admin unreachable in production builds regardless of tier — verify against an actual prod build (not `tauri:dev:test`, which likely masks this).
3. `trust-and-governance`: no pricing/tier information anywhere in-product.

**P1 — trust/quality (fix soon, high character-criteria impact):**
4. Trigger `unattended_mode` gate extended to cover webhook/event-listener triggers, or an equivalent gate added for them.
5. Companion `use_connector` gets an approval step (or an explicit, documented exception the user can see/configure).
6. Companion prompt pipeline gains a locale parameter; companion error-display path routes through `t.*` instead of raw `AppError` strings.
7. A persistent brand-voice/style memory slot, reachable from both adoption and from-intent build, instead of a per-session-only reference-context box.
8. Sync `uat/` journey/character surface bindings and `context-map.json` references against current shipped naming (Console/Briefing→Timeline/Grid, `simple-mode` removal) — process fix, cheap, do first.

**P2 — polish (proactive-signal fixes, low engineering cost given the underlying safety work is already sound):**
9. Toast/banner when Fleet's live-slot cap hibernates a session out from under the user.
10. VaultTrustBadge live-refreshes (event/poll) instead of mount-only.
11. Tour-panel minimize/end-tour buttons get `aria-label` to match the rest of the diff's icon-button pattern.
12. "Unverifiable" health chip gets a visual treatment a skeptical buyer reads as "honest," not "quietly fine" (current neutral-gray may under-communicate vs. the intended honesty signal).
13. Manual link affordance for goal↔KPI (currently derivation-engine-only); tighten the "manual" KPI measurement's visual distinction from grounded ones.

## Strengths worth protecting (what NOT to touch)

The 2026-07-15 execution-reliability batch is the standout result of this entire sweep — `run-and-review-execution` is the only journey to reach a clean L1-pass with zero majors, and every one of its four targeted fixes (terminal-status-on-every-path, failover-to-served-ids, BYOM-routing-on-real-inputs, live-readiness-on-credential-mutation) was independently confirmed correct with unit-test backing, not just "present." The manual-review → memory/team-resume loop is the single best completion-dimension finding across all 12 journeys: an approve/reject decision genuinely resumes a held team step, not just writing a memory row. The vault's audit-gap counter and Verified/Unverifiable taxonomy are both real, tested, and already closed a finding from the prior (2026-06-19) UAT pass — a good sign the loop from finding → fix → re-verify is working. Non-English static UI coverage is uniformly excellent everywhere it was checked. None of this should be touched opportunistically while chasing the findings above.

## Panel verdict — which segments are winning vs. losing

**Winning:** the technical/builder-tier segment (software-developer, hobbyist-power, it-sysadmin) gets the most genuinely deep, well-tested machinery in this pass — execution reliability, Lab honesty, trigger composability, script sandboxing all land solidly for them, even where individual findings exist. The app's engineering quality in the execution/reliability core is real and improving fast.

**Losing, structurally, not just roughly:** the **buyer/evaluator segment** (prospect-buyer) hits two genuine blockers — no pricing, and a governance surface (Network/Admin) that's invisible to even a paying tier because the gate checks a dev flag, not a plan. This isn't a rough edge; it's the app failing to let a buyer complete their core JTBD ("decide if this is worth switching to") at all. The **non-technical/first-timer segment** (smallbiz-owner, content-marketer) is served well by UI chrome (onboarding, resume/replay, jargon-light copy where it exists) but consistently loses at the AI-content layer — no brand-voice memory, and a companion handoff that drops them into the same jargon-flavored gallery as everyone else. The **enterprise-admin/governance buyer** is caught in the same Network/Admin trap as the evaluator, plus finds the Teams Monitor a weaker audit artifact than the vault's — she can defend the credential story to a reviewer but not the multi-agent one, and can't even open the network exposure panel to try.

**One-sentence panel verdict:** the execution core is becoming genuinely trustworthy fast, but the app currently fails its two "outward-facing" audiences — the buyer trying to say yes, and the enterprise admin trying to defend a yes — on structural reachability, not on polish.
