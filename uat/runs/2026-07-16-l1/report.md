# UAT L1 Report — 2026-07-16

**Mode:** `/uat run --l1` (theoretical, code-grounded, no live app)
**Scope:** all 12 `promotion: discovery` journeys × their full relevant-Character roster (51 character×journey pairs, dispatched as 12 journey-level agents for surface-model efficiency)
**Baseline:** first full sweep since `uat/runs/2026-06-19-l1-thorough/`; overlay refreshed same-day via `/uat update` against ~4 weeks / 643 file changes.

## Scorecard

| Journey | Verdict | Blockers | Majors | Notable strength |
|---|---|---|---|---|
| run-and-review-execution | **L1-pass** | 0 | 0 | Terminal-status, failover, BYOM-routing, connector-readiness, TeamReadinessChip, and manual-review→memory/team-resume loop all independently confirmed correct in code |
| adopt-template | L1-conditional | 0 | 4 | Draft-resume, event-subscription auto-wiring, recipe hard-refusal on unrunnable adoption |
| build-persona-from-intent | L1-conditional | 0 | 2 | Real credential/connector/context grounding; Lab rating honesty + atomic Activate confirmed |
| companion-do-a-job | L1-conditional | 0 | 4 | Real tool surface (build/run/assign, not chat-only); rich, genuinely-grounded prompt context |
| first-run-onboarding | L1-conditional | 0 | 0 (1 minor) | TourHandoffOffer + footer resume/replay correctly built; 100% es i18n coverage |
| monitor-fleet | L1-conditional | 0 | 1 | Awaiting-input tiles visibly differ at a glance; hibernate/wake never silently kills work |
| set-trigger-automate | L1-conditional | 0 | 2 | Real webhook/event payload grounding reaches the prompt (locked by a unit test) |
| synthesize-team | L1-conditional | 0 | 1 (+1 minor) | Red Room/Collab/Orchestration-console retirement claims all verified accurate in code |
| test-a-tool | L1-conditional | 2 | 1 | Script-path sandbox is real defense-in-depth; HTTP-status typing and truncation flags work |
| track-goal-kpi | L1-conditional | 0 | 2 | Project-dossier view + KPI provenance badges confirmed genuinely wired to real evidence |
| trust-and-governance | L1-conditional | 2 | 1 | VaultTrustBadge audit-gap counter is real, end-to-end, and regression-tested |
| wire-credential-connector | L1-conditional | 0 | 0 (1 minor) | Trust copy live in every add path; Verified/Unverifiable distinction real and gating-safe |

**11/12 journeys clean to proceed to L2** (conditional, majors carried forward). **0 journeys L1-fail.** 1 journey (`run-and-review-execution`) reached a clean pass with zero majors — the strongest single result of the run, reflecting the 2026-07-15 execution-reliability commit batch.

---

## Blockers (4)

1. **[test-a-tool] Rate-limit failures never reach the typed error contract.** The per-tool rate limiter returns a hard `Err` before the typed `ToolInvocationResult` block is constructed — `ToolErrorKind::RateLimited` exists and is unit-tested but is structurally dead code on the direct-invoke path. `src-tauri/src/engine/tool_runner.rs:119-136` vs `tool_outcome.rs:53-54,71`.
2. **[test-a-tool] Credential/auth failures also bypass the typed contract**, for the same reason — `resolve_credential_env_vars` short-circuits with a raw `AppError` before the typed block. `tool_runner.rs:141-156`. Compounded by a **frontend bug**: any non-typed Tauri error renders as the literal string `"[object Object]"` because `useToolRunner.ts:113-114` does `err instanceof Error` on a plain-object rejection that is never an `Error` instance. This is precisely the two failure modes a hand-tester is most likely to hit first.
3. **[trust-and-governance] Settings → Network and Settings → Admin are unreachable in a production build**, independent of tier. Both carry `devOnly: true` gated on `import.meta.env.DEV` (`sidebarData.ts:201-221`), which is `false` in any shipped Tauri build — so a **paying builder/team-tier customer** (enterprise-admin, it-sysadmin) cannot reach the governance surfaces their own Character files (correctly) bind to. This may also be invisible to L2 if L2 is only ever run against `tauri:dev:test` (which likely sets `DEV=true`) — flagged as needing a distinct production-mode verification path.
4. **[trust-and-governance] No pricing/tier information exists anywhere in-product.** `Settings → Account` (full file reviewed) has zero pricing/plan UI; tier is a build-time env var invisible to the end user. A prospect-buyer cannot form a "worth switching from Zapier" verdict without leaving the app.

## Majors (18, deduped/grouped by theme)

### Docs/naming drift between the uat overlay (and even in-app labels) and shipped code
- **[synthesize-team]** The journey doc and two Character files (`enterprise-admin.md`, `hobbyist-power.md`) say the Monitor's two views are "Console"/"Briefing" — those are internal prototype codenames from the winning-variant commits. The **shipped UI labels are "Timeline" and "Grid."** A Character navigating by the documented vocabulary would not find what they're looking for. Also: the "Grid" tab's own hint text ("Separate channels side by side") doesn't match what it renders (a single-project messenger, not a grid).
- **[build-persona-from-intent]** `smallbiz-owner.md`'s Surface binding (and CLAUDE.md's doc-sync map) cite `src/features/simple-mode/**` — **this directory does not exist in the repo.** His actual reachable path is the companion-driven Home widgets, which do serve his JTBD, but the character binding itself is stale.
- **[adopt-template, track-goal-kpi]** Journey frontmatter `primary_contexts` no longer resolve against `context-map.json` (re-auto-mapped 2026-07-10 into generic buckets) — a process hygiene gap, not a product defect.

### Approval/confirmation gates are narrower than the surface implies
- **[set-trigger-automate]** The destructive-action gate (`unattended_mode`: auto/dry_run/approval) is real and well-built, but is **scoped to `schedule`/`polling` triggers only** (`UnattendedModeSection.tsx:11`). Webhook and event-listener triggers — exactly the trigger type it-sysadmin's and support-lead's actual JTBDs center on (external alert/ticket events) — have no gate at all; the control doesn't even render for those trigger types.
- **[companion-do-a-job]** `use_connector` — the one companion op category that touches a user's real external accounts — **auto-fires with no approval card** (`dispatcher.rs:185-188`), directly contradicting solo-founder's explicitly scored "unsure → routes to me" criterion.

### Grounding/personalization gaps for recurring or brand-sensitive use cases
- **[adopt-template]** No binding kind or prompt input captures brand voice/style — content-marketer's core scored criterion.
- **[build-persona-from-intent]** The reference-context grounding mechanism is real but per-session only — no persistent brand-voice profile, so a returning user re-pastes it every rebuild.
- **[companion-do-a-job]** No dedicated citation-tracking/multi-source-verification structure behind the companion's research ops — only a prose instruction to cite, unenforced structurally. Fails researcher's core JTBD at the structural level.
- **[companion-do-a-job]** Locale is **completely absent** from the companion's prompt-building pipeline (no `locale`/`language` reference anywhere in `src-tauri/src/companion/*.rs`) and from the error-message path (`CompanionPanel.tsx` renders raw hardcoded-English `AppError` strings with no `t.*` wrapping) — despite the surrounding chat UI chrome being fully and correctly localized.

### Other majors
- **[adopt-template]** New triggers/schedules created via adoption appear enabled by default with no observed pre-flight review gate.
- **[adopt-template]** The companion's Home widget hands a non-technical user (smallbiz-owner) off to the same jargon-adjacent gallery UI (readiness %, "Use Cases/Connectors/Triggers" labels) everyone else uses — no tailored path for his stated zero-jargon bar.
- **[adopt-template]** Two structurally separate, non-cross-linked adoption systems (Templates/Generated vs. Recipes) create real navigational ambiguity for a multi-client consultant (freelance-agency).
- **[track-goal-kpi]** No manual UI exists to link a hand-authored goal to an existing KPI — the connection only happens via the autonomous derivation engine; a user (or an admin needing to demonstrate the link to a reviewer) cannot draw that line by hand.
- **[track-goal-kpi]** `manual`-kind KPI measurements are a standalone-number escape hatch with no cross-check beyond an honest-but-easy-to-miss "Manual entry" badge — undermines the "distinguishes activity from moved-the-number" DoD for any KPI a user chooses to measure by hand.
- **[trust-and-governance]** The Teams Monitor, being positioned as a de facto multi-agent audit trail, lacks the ergonomics (typed human-vs-agent actor distinction, filter, export) the credential audit log already has — a materially weaker artifact for a security-review defense than its vault counterpart.
- **[monitor-fleet]** The live-slot concurrency cap genuinely never kills in-progress work (confirmed: only Idle/Stale sessions are evictable), but the eviction is **not proactively surfaced** — a hibernated tile simply vanishes from the grid with no toast, only a passive count-bar delta and a hover-title reason string.

---

## Minor findings of note (not exhaustive — see per-character run transcripts)
- a11y-user: tour-panel minimize/end-tour icon buttons rely on `title`-only naming, inconsistent with every other icon control in the same diff (which correctly pair `title` + `aria-label`).
- wire-credential-connector: the "Unverifiable" health chip renders neutral-gray, not amber — a prospect-buyer skimming for 20 minutes could plausibly read it as "quietly fine" rather than "honestly unverified," even though the underlying design intent is sound.
- VaultTrustBadge only refreshes on mount — an audit-write failure occurring while the credentials tab is already open won't flip the badge until the component remounts.
- Broadcast in Fleet can target a session that transitions to non-live between refresh and send — handled gracefully via a partial-failure toast, not a silent drop, but worth an explicit L2 confirmation.

## Strengths to protect (do not regress)
- The 2026-07-15 execution-reliability commit batch (`f7bbfc793`, `7f597dbe9`, `f3980e346`, `cbb747843`, `bc55cb55a`) is the single strongest evidenced area of the app this run — terminal-status-on-every-path, failover-to-served-model-ids, BYOM-routing-on-real-inputs, live-readiness-on-credential-mutation, and team-degraded-run visibility are all independently confirmed correct with unit-test backing.
- The manual-review → memory/team-resume loop (`reviews.rs:1141-1225`) genuinely resumes held team assignment steps, not just writing a memory row — the single strongest completion-dimension finding of the run.
- The VaultTrustBadge audit-gap counter is real, end-to-end wired, and has its own regression test that deliberately breaks the audit table to prove the counter (and non-blocking behavior) hold.
- A prior UAT finding (credential-vault trust copy gated to password-type fields only, `2026-06-19` run) is now confirmed **resolved** — the trust tooltip covers every credential type post `oauth-field-surgery`.
- Lab's rating-honesty (degraded/partial-coverage flags) and Activate's atomicity are both genuinely implemented, not cosmetic — confirmed via code + a unit test that proves byte-for-byte rollback on a mid-transaction failure.
- Script-path sandboxing in the new Tool Runner is real defense-in-depth (canonical-path escape checks, symlink-safe, unit-tested) — the one part of that journey's DoD that fully holds.
- Non-English (es) UI-chrome coverage is consistently excellent across every journey checked (100% key parity, no first-paint English flash risk, natural-reading translations) — the gap is specifically in *AI-generated content* locale grounding, not static UI strings.
