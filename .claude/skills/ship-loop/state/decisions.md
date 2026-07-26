# Decisions log

## CP2 — USER ANSWERS (2026-07-02/03, resolved one-by-one)
- Ship bar: **DISTRIBUTABLE BETA** (user-confirmed) — a colleague can install + auto-update. Ops 🔴 becomes the campaign; signing/updater/versioning are in scope.
- Milestone 3: **Ops unbrick** (user picked A) — items 34, 35, 37, 38, 39, 40. Item 36 (code signing) gets its own decision when reached.
- Topics 3-9 (product calls 4/9/10/11/12, security designs 22/24): being resolved one-by-one below.
- Item 24 (OAuth tokens over IPC): **SERVER-SIDE BINDING** (user picked A) — OAuth status returns a one-time session reference instead of tokens; create/update_credential accept the reference and the backend copies tokens from the OAuth session into the vault directly. Tokens never cross IPC.
- Item 22 (assetProtocol scope): **APP DIRS + MEDIA ROOTS** (user confirmed) — scope to app-data (icons, generated artifacts) + Pictures/Videos/Downloads + the artist output dir; drop "**". Arbitrary outside paths stop rendering (accepted). Verify artist + icon flows live after the change.
- Item 12 (factoryMock dead code): **DELETE** (user confirmed) — remove factoryMock.ts entirely; git history preserves it.
- Item 11 (FleetPairDevice scaffold): **DEV-FLAG IT** (user picked B) — card mounts only in dev builds (import.meta.env.DEV); invisible in beta installers until a real pairing backend exists.
- Item 10 (autonomous triage sub-flags): **FOLD INTO MASTER** (user picked B) — the master autonomous toggle sets autonomous_review_triage + autonomous_message_triage too; remove the separate-opt-in promises from execution/companion docs. Fewer knobs by design.
- Item 9 (prototype A/B switchers): **CONSOLIDATE ALL FOUR** (user picked A) — Trigger Studio Patchbay/Baseline, Red Room Transcript/Relay, Collab Correspondence/Baseline (winner pre-declared), PresetStudio variants. Evident winner per surface (verify via recent-commit/polish signals), delete loser + switcher, one atomic commit each — the established /prototype consolidation ritual.
- Item 4 (Trigger Studio commit): **WIRE THE COMMIT PATH** (user picked B over hide/bridge/label) — implement draft→real trigger creation end-to-end. L-sized; schedule as its own milestone (M4 candidate) after the Ops unbrick.

## Auto-decided (pending user review at CP0)
- 2026-07-02 — No ship-loop skill definition (SKILL.md) exists anywhere on this machine; procedure reconstructed from the seed artifacts + the kp-repo precedent (archive seed → boot gate → 5 audit lenses → scorecard/backlog → CP0).
- 2026-07-02 — Prior ai-bookkeeper state archived to archive-ai-bookkeeper/ (identical seed copies confirmed in kp/systedo-case/personas-web; that repo does not exist on this machine); fresh loop booted for personas.
- 2026-07-02 — Dimension 5 adapted "Billing value" → "Tiering & packaging value" (personas has starter/team/builder tier bundles, no billing).
- 2026-07-02 — Dimensions 4 (Simulated UAT) and 9 (Value & market) filed as backlog items rather than run at boot (mirrors the ai-bookkeeper dry run, where e2e ran at the first milestone gate and the value lens was queued for CP1).
- 2026-07-02 — Foreign in-flight pty.rs modification left untouched; FleetBroadcastModal test failures (item 1) possibly entangled with that work — flagged, not fixed at boot.
- 2026-07-02 — Registered in .claude/active-runs.md (entry ship-loop-boot; ledger left unstaged per concurrent-write hazard convention).

## Auto-decided during M1 (pending user review at CP1)
- Item 24 resized S→M and deferred: encrypting backend→frontend IPC responses needs a frontend session keypair (write-path crypto is one-directional) or a server-side token-binding redesign; security architecture ⇒ human review per CLAUDE.md.
- Item 22 deferred with evidence: assetProtocol scope-down would break custom icons + artist media rendering from arbitrary paths; needs a media-roots product decision.
- Item 23 approach: gated the env-var bridge path to debug_assertions (not a token scheme) — smallest reversible change that closes the release exposure; "Production Build Testing" docs updated to match. Review if you want release-shaped smoke builds to keep working without the compile feature.
- freezePrototype briefly suspected of breaking tours, bisected, exonerated — the real cause was pre-existing spec drift (completion celebration screen). Flag is ON in shipped config now.
- Tours harness convention established: CARGO_TARGET_DIR=.personas-e2e-target + pre-warm build (dir gitignored). Without it the harness can't build while the dev app runs.

## CP1 (2026-07-02) — USER AFK AT CHECKPOINT, provisional defaults applied
- Ship bar: STILL DEFERRED (asked twice; existential) → re-ask at CP2. Ops campaign stays parked.
- Milestone 2: Test-pin batch, scoped to items 13 (migrations idempotency/reopen), 14 (credential injection), 19 (errorRegistry), 21 (db init/reopen smoke). Items 16+18 → M3 candidate. Item 20 BLOCKED→DEFERRED: pty.rs's foreign working-tree edit was discarded mid-session, but the file remains another session's hot area (3 of the last 4 fleet commits iterate spawn_session; testable seams are inline closures whose extraction would prejudge that in-flight design). Revisit at CP2 or when fleet work settles.
- UAT depth: tours baseline per gate (provisional).
- Product decisions (4,9,10,11,12) + security designs (22,24): remain open for the user.

## CP0 — boot (2026-07-02) — USER AFK AT CHECKPOINT, provisional defaults applied
- Ship bar: DEFERRED (existential, not auto-decidable) → re-ask at CP1. Consequence: Ops 🔴 items (34-40) stay parked until the bar is known.
- Cadence: Milestone (recommended default, provisional)
- UAT depth: deferred with ship bar; tours e2e baseline runs at the M1 gate (covers item 41)
- Milestone 1: items 1, 2, 6, 7, 15, 17, 24, 25 (correctness+security, small reversible) + stretch 22/23 only after usage verification; product DECISIONs untouched
- Execution mode: main checkout (NOT a worktree) with strict per-path staging + atomic commit per item — follows the user's standing "controlled chaos over branching" directive and precedent sessions; foreign pty.rs mod left strictly alone. Commits happen (dry-run precedent: items committed while user AFK); NO push.
