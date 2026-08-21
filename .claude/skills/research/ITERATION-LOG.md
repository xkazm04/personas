# Iteration Log — /research

Why each non-obvious rule in `SKILL.md` exists. **Read this before deleting a rule
that looks redundant** — the reason may still apply.

Split out of `SKILL.md` on 2026-08-21: it was 337 of that file's 1,658 lines (20%),
loaded into context on every invocation while directing no behavior. Sibling of
`LESSONS.md`, same on-demand contract.

---

### 2026-04-08 — initial run on A2A Gateway video (run 1/5)

**Rules added:**
- **Phase 6 host-infrastructure-first ordering.** Discovered that the second-order grep (`axum|HttpServer` against the whole codebase) reframed 4 of 7 surviving findings from "build new infrastructure" to "add to existing router". Without that step, file anchors and effort estimates were wrong. Cost of the rule: one extra grep per run. Benefit: catches existing surface area before findings are presented.
- **Phase 6 security escalation rule.** A grep for `api_key|Authorization|Bearer` against `engine/management_api.rs` returned `No matches found` — and that *was the finding*. The video didn't mention security at all; the codebase reality made it the most important item. Without the escalation rule, the finding would have been dropped as "no existing pattern".
- **Phase 7 cluster detection.** All 4 accepted findings landed in the same file (`engine/management_api.rs`) with natural dependency edges. Presenting them as a flat numbered list lost the bundling story; the user had to manually re-cluster them. Now Phase 7 does it before printing.
- **Phase 8 Option B (implementation plan handoff).** When 3+ findings cluster, individual `/gsd:add-todo` items lose the dependency graph. The user explicitly asked for a self-contained handoff document instead. Pattern is: write to `.planning/handoffs/{date}-{slug}.md`, include non-goals as the most important section (prevents implementing CLI from drifting), record the path in the Research note frontmatter and Phase 11 summary.

**Rules considered but not added:**
- "Always grep for security patterns even when the source doesn't mention security" — too broad, would create noise on most runs. The escalation rule is narrower (only fires when the host is HTTP/IPC/external surface).
- "Auto-write handoff plans whenever clusters form" — too aggressive. Cluster *detection* is automatic; the routing decision (Option A/B/C) stays with the user.

**Open questions for future runs:**
- Does the bundling pattern hold across different source types? (this run was a tightly-scoped technical video — articles may extract more diffuse findings)
- Is the 30-second timestamp anchor frequency right? Could be denser for fast-paced videos
- Is loading all 3 reference files always worth the token cost? Focus-aware loading (Phase 1a) helps but only on user opt-in

### 2026-04-08 — runs 2 and 3 batch update (after Codex/Bolin video)

**Rules added (Phase 6):**
- **Step 1b — Catalog vs runtime check.** Before scoring any "tool surface" / "prompt size" / "connector count" finding, verify catalog count ≠ runtime count. Personas has 87 connectors in the catalog but each persona binds only 0-3. Got bitten by this in run 3 when I built an architectural critique on the wrong denominator. The rule prevents future runs from making the same mistake.
- **Step 1c — Framework vs plugin routing.** Before deciding the file anchor for a code finding, check whether it belongs in core engine or in a plugin. Personas-the-framework is general-purpose; SDLC features go in `dev-tools` plugin. Misrouted findings [3] and [4] in run 3 — the user corrected by pointing me to `src/features/plugins/dev-tools/`.
- **Step 3 efficiency note** — when verifying host infrastructure, read 30 lines (struct + public API), not 500 lines (full implementation). I read 481 lines of `desktop_discovery.rs` in run 2 to confirm it existed; could have read 30.
- **Security escalation rule expanded** — now also covers "spawn site for privileged subprocess with no sandbox", not just "HTTP/IPC surface with no auth". Both follow the same pattern: privileged surface + missing standard defense → CRITICAL severity. Run 3's `--dangerously-skip-permissions` finding fit the new shape.

**Rules added (Phase 10):**
- **Step 10e — codebase-stack.md update check.** After each run, ask: did this run discover a structural fact about the codebase that future runs would need? If yes, edit `codebase-stack.md`. Runs 2 and 3 both discovered such facts (run 2: cloud client/runner exists; run 3: catalog vs runtime + framework vs plugin) — capturing them in the file prevents the same misframe in future runs. The file is hand-curated and `/refresh-context` does NOT regenerate it, so edits are durable.

**Rules considered but not added:**
- "Auto-write handoff plan when 3+ findings cluster with file anchors" — three runs in a row produced handoff plans, so the pattern is established, but I'm not making it the silent default yet. The user's choice between Option A/B/C is part of the value of Phase 8 — automating it would remove the user's ability to say "actually, don't bundle this run". Leaving as user-choice.
- "Always grep for security patterns proactively" — too broad; would create noise. The escalation rule is narrow and targeted (only fires on privileged surfaces with missing standard defenses).

**Open questions for future runs:**
- Pattern observation: 3 runs, 3 handoff plans. Run 4 will test whether this is a pattern or just selection bias from picking dense technical videos.
- Two runs in a row needed `codebase-stack.md` updates. Is this a 1-2 runs-of-update phenomenon, or is the file going to keep accumulating corrections indefinitely?
- The discovery brief format (run 2 [4], run 3 [5] originally) is being descoped consistently. Either the user doesn't want them, or I'm proposing them at the wrong moments. Watch this in runs 4 and 5.

### 2026-04-08 — release log content is news, not a changelog (run 3/5)

**Rules added (Phase 12 rewrite):**
- **The release log is user-facing news.** First version of Phase 12 wrote technical descriptions ("Adds external_api_keys table, Bearer token middleware...") and source pointers (`.planning/handoffs/2026-04-08-...`) into the release log. The user opened the app, saw an internal changelog, and rejected the entire framing: "this is now designed as internal log, we should rather redesign into user-facing news. Planning file reference is not valid then, language should rather present impact and benefit then technical resolution." Phase 12e now has explicit voice rules + the "translation test" (would a non-developer who has never seen the codebase understand and care?), and Phase 12d explicitly drops the `source` field from the structural item.
- **i18n is non-negotiable.** Phase 12 used to write to `releases.json` only with English `title`/`description` fields baked in. That broke the project's i18n contract — every user-facing string must live in all 14 locale files. Phase 12 now writes to BOTH `releases.json` (structural metadata: id/type/status/dates) AND every locale file under `src/features/home/components/releases/i18n/` (English content + TODO markers in the 13 non-English files). Skipping any locale file crashes the UI at runtime because the `useReleasesTranslation` hook does direct property access.
- **Phase 12b (locate i18n folder) is a precondition.** Before writing anything, the skill verifies all 14 locale files exist. Missing files are a hard stop, not a "best effort" — refusing to ship a partial set is safer than corrupting the structure.
- **Voice rules live in CLAUDE.md, referenced from skill.md.** The actual voice rules ("lead with impact, no file paths, no jargon, one idea per item, translation test") live in `.claude/CLAUDE.md` → "UI Conventions → Internationalization → Voice for user-facing copy". Phase 12 references them rather than duplicating, so all code-touching skills (handoff executors, /add-template, /add-credential, ad-hoc edits) get the same rule from the same place.

**Rules considered but not added:**
- "Auto-translate the strings into all 14 languages." Too risky — translation quality matters and an LLM-generated French changelog would embarrass the project. Phase 12 writes English everywhere with TODO markers; humans translate later.
- "Skip locale files for languages the project hasn't shipped translations for." That's the trap that breaks i18n contracts in every project. Either every key is in every file, or the system is broken in subtle ways for some users.

### 2026-04-08 — release log integration (run 2/5)

**Rules added:**
- **Phase 12 (release log update).** After the A2A gateway run, the user shipped a "What's New" view backed by `src/data/releases.json`. The skill now offers to append accepted findings to the active release at the very end of the run, with type inferred from bucket + severity + keyword heuristics. The phase is **skipped entirely if zero findings were accepted** so it stays unobtrusive on dry runs.
- **Type inference order matters.** Security escalation > fix keywords > breaking change > docs > feature. The first match wins. This keeps a security-related code change from getting filed as a generic "feature" when it was the most important reframing of the run.
- **Source field convention.** Handoffs are first-class anchors; todos are not (they move). When neither exists, the Obsidian Research note path is the durable fallback. This means the "↪ source" line in the UI almost always points at something the user can re-open and read.
- **One-source-of-truth invariant.** `src/data/releases.json` is also the data source for the legacy roadmap timeline view, not a parallel store. Adding items only via Phase 12 (and never from any other phase) prevents the kind of skill-creep where two phases edit the same file with different conventions.

**Rules considered but not added:**
- "Auto-bump the version when filings cross some threshold." Out of scope — version bumps are a human decision tied to release cuts, not extraction volume.
- "Write to a separate `pending` bucket and have the user move items into a release later." Adds a workflow step the user has to remember. The active release IS the pending bucket.

### 2026-04-08 — post-session batch update (follow-ups from runs 1-6)

After the 6-run iteration session completed, six follow-up topics accumulated as "queued for later". This entry is the batch that applied them. Each one was observed across multiple runs before being codified.

**Rules added:**

- **Phase 8 Option B is now the DEFAULT for 2+ clustered code findings.** Across runs 1-6, the user picked a handoff plan in every single run that produced 2+ findings with file anchors. The old "three options, ask the user to pick" framing added friction without value. The skill now proposes the handoff as the default and only offers alternatives (A for single finding, D for pure defer) when the shape is clearly different. Run-5-style direct implementation is still a user override, not a Phase 8 option — it's what happens when the user tells the skill to implement instead of plan.

- **Phase 8 Option C — theoretical scaffolding handoff.** Run 6 (Claude Managed Agents launch) produced the first handoff where the feature was behind a whitelist gate and no real integration was possible. The shape is distinct enough from a regular handoff to warrant its own name: stub provider + reserved settings keys + `TODO({feature-name}-{reason})` breadcrumbs + strict non-goals forbidding any real HTTP calls. Picked when the source describes a product in public beta / research preview / whitelist gate / un-documented API. The existence of this option prevents the discovery-brief fallback for architectural findings that DO have a compilable stub.

- **Discovery briefs demoted.** Only 1 of 3 attempted discovery briefs across runs 1-6 survived (run 2's cloud-headless-personas). Runs 3 and 6 each had a candidate; run 3 was descoped entirely, run 6 was converted to Option C. Pattern: users prefer concrete plans (even stubs) over pure analysis documents. The skill now explicitly does NOT propose discovery briefs as a first-class option — only as a last-resort escape hatch when nothing code-shaped exists to scaffold. Run 1-2's baseline "discovery brief is a first-class Phase 8 option" was the wrong framing.

- **Phase 2b agnosticism note.** Run 6 was the first article source (blog post via WebFetch); runs 1-5 were all YouTube. Both paths produced identical downstream shapes — same frontmatter, same rules, same outputs. Added a short note in Phase 2 confirming this so future runs don't waste energy worrying about source-type branches in downstream phases.

- **Phase 3 source-type yield calibration table.** Added after observing that run 4's 2 findings / 8 catches felt low when it was actually a high-signal product-demo run. The calibration table maps source type → expected yield profile so a future run can self-assess whether "only 2 findings" is failure or expected behavior. Five source types documented from runs 1-6: technical interview (densest), feature walkthrough (dense), product demo (low + many catches), philosophical article (low, mostly deltas), product launch (low-medium, scaffolding-shaped). When the count feels low, check the type first.

- **Phase 10f — descoped-but-reopenable tracking in `Patterns/descoped-reopenable.md`.** Run 4's "maximizer mode" was descoped because of the hard goal-verification problem. Run 6 discovered Anthropic solved the same problem externally. A properly-tracked descoped-reopenable entry from run 4 would have flagged this in run 6's Phase 3 automatically. The new Phase 10f adds entries when a user descopes a finding with a specific external blocker (not "no business need" or "too niche" — those are permanent rejections). Phase 3 reads this file and surfaces revived candidates. The file is separate from `user-preferences.md` because these are conditional waits, not permanent rules.

- **Phase 11 — `already_existed` count surfaced in the printed summary.** Previously tracked only in Research note frontmatter from run 4 onward. Now surfaced as a first-class line in the printed final summary, with a per-catch list. Also added a "surface this prominently when the finding count is low" reminder — a 2-findings / 8-catches run should be framed as high-yield, not low.

- **Phase 11 — `descoped-reopenable` count surfaced.** Parallel to `already_existed`. Tracks how much potential work is parked against external blockers.

- **Phase 11 — `source-type yield` line.** Tells the user whether the run's output matches the expected profile for the source type. Prevents "this run felt low" reactions when the run was actually performing correctly.

**Rules considered but not added:**

- "Auto-write a handoff plan without asking the user." Too aggressive. Cluster detection is automatic; the final Phase 8 decision still belongs to the user. The change is defaulting toward B, not bypassing user consent.
- "Run Phase 3's descoped-reopenable cross-check automatically on every run without surfacing it." Defeats the purpose — the whole point is for the user to see when a previously-blocked finding is now viable. It stays visible in Phase 7 output.
- "Add fuzzy matching for descoped-reopenable 'reconsider triggers'." Out of scope for v1. Exact-substring match on the trigger phrase is enough until there's a real miss to justify complexity.
- "Demote Phase 12 (release log) similarly to discovery briefs." Phase 12 has different dynamics — it's a terminal write, not a mid-run routing decision. It stays.

**Open questions for future runs:**

- The Phase 3 yield calibration table was written after 6 runs of data. Does it generalize to run 7+? If a run produces a source type not in the table, the skill should extend the table rather than force-fit.
- Phase 10f tracks descoped-reopenable entries but doesn't delete them when blockers clear. The "cleanup" rule exists but has never run in practice. Watch for file growth over time.
- The "handoff as default" change means the user sees fewer Phase 8 choices. If that feels prescriptive on a specific run, the user can still override — but if overrides happen frequently, the default may be wrong. Track override rate across the next few runs.
- Option C (theoretical scaffolding) has only been used once (run 6). Whether the strict non-goals section holds up in practice — or if implementing CLIs drift into real HTTP anyway — is unknown until a second scaffolding handoff exists.

### 2026-04-11 — i18n infrastructure integration (post vibeman run #3)

**Context:** vibeman run #3 built the i18n infrastructure for the personas project — deep merge, token maps, error registry bridge, ESLint rule, locale parity script. CLAUDE.md now has a comprehensive Internationalization section. The research skill needed to be updated so handoff plans that touch frontend code carry the i18n contract forward to implementing CLIs.

**Rules added:**

- **Phase 6 — i18n impact check.** When a code finding touches frontend files (`src/**/*.tsx`), note whether it introduces new user-facing strings. If yes, mark `i18n: required` and add an effort note. For backend status tokens, note that `tokenLabel()` must be used. This catches the i18n cost at evidence-gathering time, not as a surprise during handoff execution. The safety rule at line 843 already covered the "never write English directly" prohibition, but the Phase 6 check surfaces the requirement earlier — at the finding level, before triage.

- **Phase 8 Option B cross-cutting concerns — explicit i18n bullet.** The typography contrast bullet existed; now an i18n bullet is mandatory alongside it for any handoff that touches `src/**/*.tsx`. References the specific tools: `useTranslation()` for UI strings, `tokenLabel()` for backend tokens, `resolveErrorTranslated()` for errors. Points to CLAUDE.md → Internationalization for the full contract.

**Why both rules matter together:** the Phase 6 check tells the user "this finding has i18n cost" at triage time, which affects effort estimates and priority. The Phase 8 cross-cutting concern tells the implementing CLI "here's how to honor i18n" at execution time. Without Phase 6, the user may accept a finding not realizing it requires en.ts changes. Without Phase 8, the implementing CLI may write hardcoded English despite the ESLint warning.

**Rules NOT added:**
- "Force all findings that touch .tsx to include i18n migration of existing hardcoded strings in the same file." Too aggressive — that's a separate goal (i18n Phase 2-8 migration), not a research skill concern. The research skill only ensures NEW strings from its findings go through i18n, not that existing strings in the same file get migrated.
- "Add i18n effort as a multiplier to the relevance score." The i18n cost is ~5 minutes per finding (add key to en.ts, use t.section.key in component) — not enough to change a relevance score.

### 2026-04-11 — Phase 13 atomic commit (post merge-loss incident)

**Context:** A bad merge on 2026-04-11 wiped out multiple research sessions' worth of code — Task Runner depth presets, DevProject monitoring fields, event registry entries, TaskOutputPanel markdown toggle, command name registrations, store slice signatures, API wrappers. None of it was committed. The Rust models still had their old struct shapes, the frontend bindings had reverted to pre-run forms, and the migration file still contained the ALTER TABLE statements — a classic broken-state drift. Recovery took ~30 minutes of manual re-typing from the conversation transcript.

**Root cause:** The research skill ended after Phase 12 (or Phase 11 if Phase 12 skipped) with no commit step. "Just commit manually later" was the implicit default. The Obsidian vault persisted the Research/Lessons notes (so the *learning* was intact), but the code changes from `implement right away` runs and handoff plans had no git anchor. A subsequent merge reconciliation dropped them silently.

**Rule added: Phase 13 — Atomic Commit (mandatory).**

Every research run now ends with an explicit commit step. The design choices:

- **Explicit file staging (`git add <path>`), not `git add -A`.** Avoids sweeping up secrets, build artifacts, or drift from concurrent sessions. The skill builds the file list from known outputs (handoff path, in-session edits, release log files).
- **`research:` commit prefix.** Makes research-run commits filterable via `git log --grep="^research:"`. Useful for forensics and for the `/gsd:pr-branch` skill to detect research commits when building PR branches.
- **Commit body explains *why*, not *what*.** The file list is in `git diff`; the message records source URL, accepted findings, handoff path, and catalog invocations. This is what's valuable in `git log` a month later.
- **No `--no-verify`, no `--amend`.** Hooks run, and if they fail, the skill fixes inline and creates a NEW commit. Amending after a hook failure loses the hook's feedback.
- **Only two skip conditions: no changes, explicit user opt-out.** "I'll commit later" is not a valid skip — the whole point is to make the commit happen *now*, before context is lost. The skill gently pushes back if the user offers to commit manually.
- **Phase 11 summary shows the commit SHA.** One line the user can scan to verify the run is safe in git before closing the session.
- **Commit failure doesn't block the Research note.** Even if the commit fails, the Obsidian Research note and Lessons note are written — the learning loop is always preserved, separate from the code-safety loop.

**Rules considered but not added:**

- "Push after commit." Too much side effect — push is a shared-state action, commit is local. The user may want to review multiple research commits before pushing. Phase 13 stops at commit.
- "Auto-create a branch for each research run." Overkill for single-finding runs. The `/gsd:pr-branch` skill already handles branch creation when needed.
- "Use `git stash` as a safety net before the run." Wrong direction — stashing makes recovery harder, not easier. Commit IS the safety net.
- "Block Phase 13 on TypeScript errors." Too brittle — pre-existing errors in unrelated files would block every research run. The pre-commit hook is the right place for lint/type checking.
- "Run `tsc --noEmit` automatically before committing." Compelling but expensive — tsc takes 60-90s on this repo. The pre-commit hook runs it for changed files already; full checks belong in CI.

**Open questions for future runs:**

- Will users respect the explicit stage rule, or will they push to include unrelated drift? The "unexpected files" prompt in 13b is the checkpoint — watch whether it fires often or never.
- Does the `research:` prefix get picked up by `/gsd:pr-branch`? It should — verify on next PR cycle.
- Is the commit message template too verbose for single-finding runs? Possibly — the "optional 1-2 line summary" slot is there to let short runs stay short.

### 2026-04-14 — "consumer web-app build tutorial" as a new zero-yield source type

**Context:** `/research` run on "Build and Deploy A Production Ready Events Manager Website | NextJS, React, TailwindCSS, PostgreSQL" (Pedro Tech, sponsored by Neon). Focus was templates + credentials. The video is a ~1h55m walkthrough of building a consumer-facing events-planner web app from scratch (Next.js + Prisma + Neon Postgres + Neon Auth + Vercel). **Result: 5 candidates extracted in Phase 3, zero survived Phase 4.** Every candidate was either already in the catalog (Neon, Vercel, GitHub) or not connector-shaped (Neon Auth = user-login primitive, Prisma = Node library, Event RSVP template = consumer web app flow, not an agent workflow).

**Rules added (Phase 3 calibration table):**

- **New source-type row — "Consumer web-app build tutorial."** Title pattern: "Build [and Deploy] X with [React|Next|Vue|Svelte] + DB + deploy stack" where X is a consumer-facing web app (events planner, dashboard, landing page, SaaS clone, etc.). Expected yield: **0 findings + 1-4 already-existed catches**. The overlap between "personas orchestrates AI agents that call APIs" and "how to build a React CRUD app for end users" is near-zero. The only findings such a source can produce are (a) a credential for a service the video uses, if not already in the catalog, or (b) an agent-shaped template that RE-imagines the consumer domain as an automation flow — but the re-imagining rarely survives the dedup check against existing calendar/meeting/notification templates.

- **Recommended action for this source type:** do the full Phase 3 extraction (5 candidates) to prove the drop, write a stub Research note + Lessons entry, commit. Do NOT stretch into a weak finding — a forced template that duplicates existing agent-shaped templates is net negative for the catalog.

- **New Phase 4 filter: "user-login auth vs machine-to-machine API auth"** (first observation, not yet a codebase-stack rule). When a new auth product appears as a credential candidate, test whether it's *user-facing login for end users of YOUR app* (Clerk, Auth0, Better Auth, Neon Auth, Supabase Auth — **drop**) or *machine-to-machine API auth your agent consumes* (**connector-shaped, keep**). This run was the first time the distinction mattered — Neon Auth was the borderline case and dropped cleanly once the filter was applied. Watch for a second observation. If it happens again, promote to `codebase-stack.md` as a permanent rule in Section 3 (connector binding model).

**Phase 6 tool-grep-first heuristic validated as the highest-leverage early move.** For sources where the title hints at "build X with Y and Z", running a tool-name grep across the cleaned transcript (`neon|prisma|vercel|clerk|stripe|resend|...`) before the deep read catches the entire "services mentioned" surface in one call. If every grep hit is already-existed or not-connector-shaped, the run is probably zero-findings — bail to stub-note early with confidence. Time cost: ~30 seconds. Benefit on this run: confirmed within ~2 minutes of loading the transcript that no new credentials were in play, which freed me to focus the deep read on the template question.

**Rules considered but not added:**

- "Auto-skip any video whose title matches the consumer web-app build pattern." Too aggressive — occasionally such videos DO surface a new deploy/DB/auth service worth adding. Better to do the full Phase 3 extraction and prove the drop, which takes ~15 minutes and produces a permanent Research note that prevents re-harvesting. The stub note is the insurance, not the bail-out.

- "Promote the user-login vs M2M auth filter to codebase-stack.md now." One observation isn't enough. If the same filter saves a second run, promote then.

**Open questions for future runs:**

- How common is the consumer-web-app-tutorial source type in practice? This is the first one in 14 runs. If it stays rare, the calibration table entry is documentation-only; if it becomes common (the YouTube algorithm feeds a lot of them), the early-bail heuristic becomes load-bearing.
- Does the stub-note-only path feel right to users, or will they push for at least one speculative template even on zero-yield runs? This run got approval for stub-only framing, but that's n=1. Watch the next zero-yield run.

### 2026-04-14 — Hermes Agent run + Lessons-file data-loss incident

**Context (Hermes run):** `/research` on "Hermes Agent: The Self-Improving AI That Learns You" (Nous Research open-source agent walkthrough sponsored by OpenRouter). Focus: code. Source-type: product demo / competitor walkthrough. Result: **4 findings, 11 already-existed catches, 1 descoped**. Findings [1-3] bundled into a single handoff at `.planning/handoffs/2026-04-14-learning-loop-auto-triggers.md` (periodic reflection nudge + auto-recipe distillation post-success + recipe self-update on re-execution improvement). Finding [4] (per-key API rotation on rate limit) descoped to `Patterns/descoped-reopenable.md` per user-preferences risks-first rule (sixth observation).

**Rules added (Phase 6):**

- **Phase 6 Step 3b — "read the signature before proposing reuse."** When a finding proposes to reuse an existing function, read that function's SIGNATURE before assigning relevance score. The initial framing of Finding [2] was "reuse `build_recipe_generation_prompt` for auto-gen" — which would have been wrong, because the function is credential-centric (`credential_name`, `credential_service`) and cannot distill workflows from execution traces. Reading the actual source in Phase 6 caught the mismatch and reshaped the handoff from "trivial hook" to "new sibling module with its own prompt." **Rule:** before the Phase 7 presentation, read the public API of any function a finding claims it will reuse. A function name that sounds right can still be semantically wrong.

- **Phase 6 Step 0 — "grep personas-specific vocabulary for agent-adjacent claims."** When a source claims a feature with a generic name (user modeling, knowledge base, skills, memory), the host-first grep should include both the generic terms (`user_model|user_profile|preferences`) AND personas-specific vocabulary (`twin|genome|manifest|enclave|bundle|shared_memory|persona_recipe`). The Twin plugin was the biggest catch of the Hermes run and would have been missed if I'd only greped for the generic terms. The Twin table names don't contain "user" at all — they contain "twin". **Rule:** add a short vocabulary list to every host-first grep for category-matching findings.

**Rules added (Phase 8 / handoff generation):**

- **Phase 8 runner-hook findings require a `test-run guard` as a first-class non-goal.** First observation of a class of failure: any runner-attached hook that writes to learning/memory/recipe/skill tables can contaminate evaluation paths (genome, evolution, test_runner, eval, lab, arena) because they all share the same runner. The evaluator runs personas to score them; if a hook writes artifacts whose existence is caused by evaluation, the scoring becomes self-referential and fitness corrupts. **Provisional rule:** when a finding proposes a runner-attached hook that writes to any learning artifact, the handoff's Non-goals section MUST include an explicit "do NOT fire during test/lab/eval/evolution/arena executions" bullet, AND the acceptance checklist MUST include a non-regression test that proves zero writes during those paths. One observation so far. If this comes up a second time, promote to a permanent Phase 8 rule.

- **Phase 8 handoff non-goals expand when the user attaches a constraint after triage.** The user's approval message for findings [1-3] included "careful analysis not to harm current execution and evaluation processes." This single sentence dictated the entire handoff shape — every non-goal, every test-run guard, every "default-off" gating decision flows from it. **Rule:** when a user adds a constraint after triage, treat it as the PRIMARY design axis, not secondary. The handoff's non-goals section should be the longest and most specific section when such a constraint is attached — it's what the implementing CLI reads to understand what NOT to do.

**Rules added (Phase 10 / Lessons file safety):**

- **Phase 10b MUST use `Edit` (not `Write`) for Lessons files.** First observation of a concrete data-loss mode: the Lessons file path `Lessons/YYYY-MM-DD-research.md` is **shared across all runs on the same day**. On 2026-04-14 I ran three research runs (nextjs morning, twin-second-brain midday, Hermes afternoon). When writing the afternoon Lessons entry I used `Write` without `Read`ing first, overwriting both prior runs' Lessons blocks. The PreToolUse READ-BEFORE-EDIT hook fired a reminder and I mis-classified it as informational rather than blocking. Reconstructions were produced from the Research notes (which were intact — they have per-run unique filenames) but the original self-reflection wording is permanently lost. **Rule update for Phase 10b:** ALWAYS use `Edit` to APPEND to the Lessons file, never `Write` with only current-run content. If the file doesn't exist yet (first run of the day), `Write` is acceptable but must still be preceded by a file-existence check. The Research note path (`Research/YYYY-MM-DD-{slug}.md`) has a per-run slug so collision is impossible there — `Write` remains fine for Research notes.

- **Edit-first default for any shared-by-date Obsidian path.** Generalize the above: any Obsidian vault path whose filename begins with `YYYY-MM-DD-` and does NOT include a per-run slug (e.g., `Lessons/{date}-research.md`, future patterns like `Patterns/{date}-something.md`) is a shared-file-by-date and must be appended via `Edit`, never replaced via `Write`. Shared-by-date paths have an implicit multi-run collision — the safe operation is append, not replace.

- **Pre-tool-use hook reminders are advisory, not ignorable.** The READ-BEFORE-EDIT hook fires as a reminder but does not block the tool call. When the hook fires twice in succession for the same file, it is a signal that the skill is about to repeat a mistake — treat the second fire as a hard stop, read the file, reconsider the operation. Do not treat hook reminders as "just informational."

**Rules considered but not added:**

- "Auto-switch `/research` to always `Edit` instead of `Write` for everything in the vault." Too broad — the Research notes path has per-run slugs and `Write` is correct there. The rule is specifically about shared-by-date paths.
- "Block Phase 13 commit if any vault data loss is detected during the run." Can't detect data loss post-hoc unless we check file size deltas, which adds complexity for a rare failure mode. The defensive posture is "use Edit" upstream, not "detect loss" downstream.
- "Add a dry-run mode for Lessons writes that shows the diff first." Reasonable but over-engineered for a single observation. If the mistake happens again, implement dry-run.

**Open questions for future runs:**

- The learning-loop handoff has not been executed yet. Its non-goals section is extensive; the test-run guard is the load-bearing piece. Verify on the next run after execution whether the implementing CLI honored the guard or drifted. If drift happened, the non-goals format itself needs revising.
- Three runs in a single day happened organically for the first time. How common is this going to be? If >1 run/day becomes routine, the Lessons-file append pattern becomes load-bearing. If it stays rare (days with multiple runs are the exception), the rule is good defensive practice but not a frequent hazard.
- The `is_test_run` detection in personas' execution context may not exist as a clean signal. Task 0 of the handoff says "grep for existing test-run detection and reuse the same predicate; if ambiguous, default to TRUE (skip hooks)." Whether this predicate exists is unknown as of handoff-write time — the implementing CLI will have to discover it. If they come back saying "no such predicate exists," the handoff has a gap that needs filling with a fresh detection mechanism. Watch for this follow-up.

### 2026-04-30 — Option B-Design (design-then-execute) added after PokeeClaw run

**Context:** `/research` run on the PokeeClaw walkthrough produced an already-existed-heavy yield: 0 actionable findings + 8 catches + 1 weak finding (unified audit-log surface). The user accepted the weak finding's *spirit* but pushed back on the framing — *"we already have some variant of C in Overview module, new section there for Option B will be useful"* — and asked for **three different design approaches**, not a direct implementation.

The skill at the time had no labeled handling for this shape. I improvised: Phase 6 evidence-gathering round 2, then a Phase 7-shaped output with three approaches and tradeoffs, then a co-located `DESIGN.md` at `src/features/overview/sub_incidents/DESIGN.md`. The user's next turn was *"continue with design and implementation within this session"* — confirming that stopping at the design doc was wrong by default. The design doc was meant to be the contract for execution, not a separate approval gate.

**Pattern observed:**
- Some accepted findings have a clear `file_path:line` anchor — Option A or B applies directly.
- Some accepted findings need exploration first — multiple plausible designs, no obvious anchor, the user wants to choose between shapes before code lands.
- The latter category was being shoehorned into Option D (record-only) or stalling at "design written, awaiting approval", both of which fragment the work.

**Rule added: Option B-Design.** Triggers on user phrases like "propose approaches", "design first", "what are the options", "three different approaches", or "scan and propose". The shape is: scan-grounded approaches → user picks → co-located `DESIGN.md` → **immediate in-session execution** without a second approval turn. The design doc is the implementation contract, not a decision gate.

**Why a labeled option vs. a sub-mode of Option B:** the exploration step (3+ tool calls + a tradeoff-shaped Phase 7 output) is non-trivial and easy to skip; the design doc is real work (typically 1-2 KLOC of markdown); the "co-located not in `.planning/handoffs/`" rule is non-obvious. Wrapping these in a named option means future runs reuse the pattern without re-discovering it. Skipping the labeling would mean the next "propose three approaches" request gets a different shape every time.

**Co-location rule.** Design docs go next to the code they describe (`src/features/<area>/<sub>/DESIGN.md`), NOT in `.planning/handoffs/`. The 2026-04-17 demotion of handoff plans showed the cost of putting implementation contracts far from the code — they go stale silently. Co-location reverses that: a future maintainer reading the implementation finds the design next to it.

**Working-artifact rule.** The design doc is allowed to be amended during implementation when a constraint surfaces (e.g., the proposed schema conflicts with an existing index). Only structural changes that would have made the user pick a different approach require pausing for re-approval; minor amendments happen inline and the implementation continues.

**Rules considered but not added:**

- "Always write a `DESIGN.md` for clusters of 3+ findings." Too aggressive — most clusters have a clear anchor and a design doc would be ceremony. The trigger has to be the user asking for it.
- "Treat the design doc as a one-way contract — if implementation diverges, fail loudly." Too brittle — implementation always reveals constraints the design didn't see. The right rule is "amend inline, only escalate structural changes."
- "Cap design doc length." Premature optimization. The PokeeClaw `DESIGN.md` was ~16 KB and that was the right size for a 7-source promoter + lifecycle + UI feature. A shorter doc would have left implementation gaps; a longer one would have been over-engineering.

**Open questions for future runs:**

- Will users start asking for "approaches" reflexively even when the finding has a clear anchor? If yes, the trigger phrases listed in Option B-Design need a "but only when the anchor isn't obvious" caveat. Watch the next 3-5 runs.
- The PokeeClaw run's design doc had a 5-PR rollout plan. In-session execution against that plan = 5 atomic commits in one session. Will context budgets accommodate that on every B-Design run? If not, the option needs a "ship the first 1-2 PRs in-session, hand off the rest as todos via /gsd-add-todo" sub-rule.
- Co-location implies the design doc gets git-tracked. Should we add a CI rule that flags `DESIGN.md` files older than 90 days as "stale design — verify or delete"? Out of scope for this iteration, but worth noting.

### 2026-04-17 — In-session execution becomes the Phase 8 default (handoff demoted to fallback)

**Context:** Two back-to-back `/research` runs on 2026-04-17 on overlapping Claude Code CHANGELOG content:

- Morning run (2.1.110–2.1.112) → wrote `.planning/handoffs/2026-04-17-claude-cli-2-1-111-adapter-drift.md` as Option B default, did NOT execute.
- Evening run (2.1.112–2.1.114) → surfaced two follow-up findings, amended the morning handoff in place, did NOT execute.
- User's response at the end of the evening run: *"please execute the handoff in this session, note in the /research procedure not to generate handoffs, and rather execute right away and validate the results to prevent splitting sessions"* → execution finally happened in the same turn.

**Pattern observed:** three sessions of work to deliver what could have been one. Each hand-off created:

1. Context loss — the research session's mental model was lost before execution.
2. Amendment accumulation — the follow-up run had to edit the morning handoff rather than produce a clean standalone artifact.
3. A real risk surface — 2026-04-11's merge-loss incident was precisely this shape (research-session code never committed, lost to a merge).

**Rule change (Phase 8 Code bucket):**

- **In-session execution is the new DEFAULT** for all accepted code findings, single or clustered.
- **Option A** (was: single finding → Obsidian note + optional todo) → now: execute + commit + optional todo. No "note but don't implement" default.
- **Option B** (was: handoff plan as DEFAULT for 2+ clustered findings) → now: execute the cluster in-session with atomic commits per task. Present the plan inline, then execute it.
- **Option B2** added as the fallback — same structure as the old Option B. Used only when in-session execution is genuinely impractical (critical context tightness, multi-day exploratory work, unavailable deps, explicit user planning-only request).
- **Option C** (theoretical scaffolding) unchanged — it already implies scaffolding code, not a pure document.
- **Option D** (just record, escape hatch) unchanged, still rarely used.

**Validation is now a required step of Option A/B execution**, not an afterthought:

- Rust → `cargo check` in `src-tauri/`
- TypeScript → `npx tsc --noEmit`
- i18n → `node scripts/check-locale-parity.mjs`
- Frontend → `npm run lint`

Failures must be fixed inline before moving to the next task. No stacking failing commits. No `--no-verify`.

**Rules considered but not added:**

- "Forbid Option B2 entirely." Too absolute — there are real cases (multi-day exploration, whitelist-gated APIs with no integration target) where a handoff is the correct artifact. Demotion with clear escape criteria is better than a blanket ban.
- "Require user confirmation before executing Option B." Re-introduces the split that this rule is designed to prevent. The user's `/research` invocation is the consent — Phase 8's triage answer ("all", "1, 3", etc.) is the decision. If the user wanted planning-only, they would have said so, or the session constraints would have made it obvious.
- "Auto-invoke validation between every tool call." Too heavy. Per-task validation is enough; per-edit validation floods the harness with redundant checks.
- "Keep the old Option B default and add a `--execute` flag."  `/research` has no flags; the invocation is free-form. Changing the default is the right lever.

**Open questions for future runs:**

- Does the in-session execution default work for truly large clusters (10+ tasks spanning multiple domains)? The 2026-04-17 evening run had 6 tasks. A larger cluster might need to fall back to Option B2 for context reasons. Watch for the first 10+ task cluster.
- When execution breaks partway through, is an atomic "commit what worked, handoff what didn't" clean enough? Current phrasing says so, but the shape of the mid-execution fallback hasn't been tested. Watch for the first real mid-execution blocker.
- Does the new default change what users *ask* for? Users who previously expected handoff output may now ask for it explicitly. If most runs start with "just execute, don't write a plan" the rule is working. If most runs start with "write a plan first", the demotion was wrong.

### 2026-05-01 — Phase 2a cache-cleanup contract hardened (after ~20 stray files surfaced)

**Context:** During the post-run housekeeping of the 2026-05-01 Claude-Code-2-1-124-to-126 run, `git status` revealed 20+ stale `.research-cache/*.{vtt,clean.txt,cleaned.txt}` files accumulated across earlier runs. The skill's Phase 2a already said *"After parsing, delete the cache file. Keep only the cleaned text in working memory."* — but as one buried sentence, runs were silently skipping it. Fourteen prior runs failed to enforce it; the directory had been growing for weeks. Most of the strays were tracked in git (committed historically before `.research-cache/` was gitignored), so the cleanup commit was non-trivial.

**Rules added / strengthened:**

- **Phase 2a cleanup is now a labeled block, not a single sentence.** Replaced the one-liner with a bash snippet (`rm -f .research-cache/<id>.* 2>/dev/null`) plus four explicit sub-rules: scope strictly to this run's id (never sweep blindly — collides with parallel runs), idempotent on failure (log to Lessons as `cache_cleanup_skipped` and continue), verify in Phase 11, gitignore is the safety net not the primary mechanism. The visibility upgrade (own bash block + bullet list) makes the rule hard to miss.
- **Phase 11 final-summary template now includes a `Cache:` line.** Three values: `cleaned` (Phase 2a ran successfully), `n/a` (Phase 2b/c source — no cache was created), or `residue at .research-cache/<id>.*` (cleanup failed, see Lessons). Adding it to the template means future runs that omit the rm will produce a visibly-wrong final summary.
- **Safety Rules entry added.** "Phase 2a cache cleanup is mandatory" with a one-line summary of why (the 2026-05-01 finding of 20 strays). Sits next to the Phase 13 entries since both are mandatory end-of-something steps.
- **`.research-cache/` added to `.gitignore`.** Future cache files won't pollute `git status`. This is defense-in-depth, not the primary mechanism — disk accumulation still happens if Phase 2a doesn't run.

**Rules considered but not added:**

- "Sweep `.research-cache/*` blindly at the start of every run." Rejected — collides with any parallel `/research` invocation on the same machine. The id-scoped `rm` is enough; if the user has stray files from old runs, they can sweep manually (which is what 2026-05-01 did).
- "Add a Stop hook in `.claude/settings.json` that runs `rm -rf .research-cache/`." Rejected for the same parallel-run reason, and because hook-based cleanup hides the responsibility from the skill (the 2026-04-17 hooks-vs-runtime-state lesson applies — make the cleanup *part of the skill*, not external infra).
- "Have Phase 13 stage the cache cleanup as part of the research commit." Rejected — `.research-cache/` is now gitignored, so deletions are local-only. Including the directory in Phase 13's explicit-add list would re-pollute the commit with sweep activity.
- "Block Phase 11 if cache files remain." Too brittle. The skill already has a `cache_cleanup_skipped` Lessons note path; turning it into a hard block would interrupt runs for a non-blocking failure mode.

**Open questions for future runs:**

- Will the gitignore + the labeled Phase 2a block be enough to keep the directory clean over the next 5-10 runs? If a sweep is needed again, the failure mode wasn't visibility — it was something else (race, working-dir confusion, etc.) and the rule needs another iteration.
- Does the `Cache:` line in Phase 11 actually fire for Phase 2b/c sources? Today only Phase 2a creates files; if Phase 2b WebFetch ever caches body text, the `n/a` value would become wrong.
- Should `transcript.txt` (no run-id prefix, observed in the 2026-05-01 sweep) be a documented anti-pattern? It was created by some prior run that mis-named its output. If it appears again, codify "all cache files MUST be `<id>.<ext>` — never bare names".

### 2026-05-09 — Phase 2.5 web augmentation + `docs/features/` reference added

**Context:** Earlier runs treated the cleaned transcript as the only source. When a YouTube speaker name-dropped a tool or technique without explaining it, Phase 6 framing went vague — the skill couldn't grep for the right concept because it didn't know what concept to grep for. Separately, `codebase-context.md` is DB-derived and intentionally shallow (keywords + file lists), which made certain code-bucket findings hand-wave the attachment point. The implemented-product feature docs at `docs/features/` (kept current via a Stop hook described in CLAUDE.md → "Documentation Sync") were never referenced.

**Rules added:**

- **Phase 2.5 — Web Augmentation.** Bounded round (≤3 web calls) where the skill defines named tools/techniques/protocols/workflow patterns surfaced in the transcript so Phase 6 can grep for the right thing. Triggers when the source names something non-obvious AND not already in `codebase-catalogs.md`. Anti-patterns codified: do not use augmentation to validate speaker claims (that's Phase 6 against the codebase), do not cite augmentation URLs as Phase 7 source anchors (the original transcript is still the anchor), do not escalate a web finding into a separate source.
- **`docs/features/` added to Constants.** The feature reference docs are now a first-class lookup target. Phase 6 Step 3a tells the skill to read the matching `docs/features/<area>/README.md` (or `<plugin>.md`) before doing wider greps when a finding lands in a documented area. This usually surfaces the exact attachment point in one sentence and shortens the grep round.
- **Frontmatter extension.** Phase 9's Research note frontmatter gains an optional `web_augmentations` list so future re-reads can trace which canonical sources sharpened framing without re-fetching.

**Why both rules at once:** they pair naturally — Phase 2.5 sharpens *what* to grep for; `docs/features/` sharpens *where* the grep should land. Adding either alone leaves half the framing problem unsolved.

**Rules considered but not added:**

- "Run web augmentation on every source unconditionally." Rejected — many sources are self-contained (philosophical articles, product launches where the post IS the spec) and the augmentation round would be net-negative tool calls.
- "Auto-add the augmented tools as credential candidates." Rejected — that's the Phase 5 bucket-classification job. Augmentation feeds into it; it doesn't bypass it.
- "Always read every `docs/features/<area>` README at Phase 1." Rejected — token cost would explode. On-demand is the right shape; the README index in `docs/features/README.md` lets the skill navigate without preloading.

**Open questions for future runs:**

- Does the bounded `≤3 web calls` cap hold under wide-surface-area sources (e.g. a video that name-drops 8 tools)? If yes, the cap forces good prioritization. If runs blow past it, raise the cap to 5 or add a triage step that picks the 3 most load-bearing names.
- Will the `docs/features/` lookup catch findings that wide-greps would miss, or vice versa? First-pass guess: docs win for "is this implemented yet" questions, greps win for "what's the exact line". Confirm across the next 3 code-bucket runs.

