# Knowledge registry migration — impact analysis & phased plan (v0)

**Status:** analysis, 2026-08-18. Extends [`domain-knowledge-plan.md`](./domain-knowledge-plan.md)
after the operator ratified its direction and extended scope with four decisions:

1. **Reuse `github.com/xkazm04/ai-registry`** (ascent's test registry, near-empty synthetic
   seed) as the home of the Reference Knowledge Bundle (RKB) system.
2. **Skills migrate too** — Personas first, ascent follows.
3. **`docs/concepts/paths/` moves there and is deleted from personas** only after the
   registry is verified established and connected systems use it without harm (adoption,
   improvements, new items). Skills + CLAUDE.md documents in personas-managed processes
   get a rewiring review.
4. **Personas' generated agents** (which have memories but no expert system) connect to
   the RKB in a later stage.

Grounded in two fresh scouts (2026-08-18): the live registry repo contents, and a
file:line coupling inventory of everything in personas that reads/writes `paths/` or the
skills system. State at analysis time: the hierarchy is **COMPLETE — 105 subjects / 624
techniques / 236 applications**, checker green, corpus-map 247/247 `complete:true`; a
concurrent session owns the Patterns v2 UI (P1 shipped `7f281169f`: Rust reader + 14
bindings + categories.json + 4-way checker gate — **the app READS the docs; docs are the
authority**).

---

## 1. The registry as it stands — what we inherit

`xkazm04/ai-registry` is PUBLIC, updated 2026-08-18, and already carries ascent's designed
layout with deliberately synthetic example content (its README: "a worked example…
deliberately generic and synthetic… exists so tooling has something real to read"):

```
.ascent/registry.yaml    # registry:1, canonical, mode git-native|hosted-mirror, telemetry,
                         # policies{categories[7], memoryKinds[4], catalogWrites}, owners
CODEOWNERS               # merge = adopt
catalog.json             # schema "ascent-registry-catalog" 1.0.0 — hand-seeded, GENERATED thereafter
skills/<name>/SKILL.md   # name/description/category/memory/version(semver)/tags — + LESSONS.md
practices/<slug>/PRACTICE.md + starter/**
memory/<kind>/<slug>.md  # kind/confidence/namespace/source frontmatter
memory/_index.md
```

Two properties make takeover clean: **the manifest declares "unknown fields MUST be
ignored by a reader, so this file can grow without breaking old readers"** (additive
evolution is sanctioned in-band), and **all content is disposable fixture** ("do not
hand-edit; change the source files instead" applies only to catalog.json).

**Takeover decisions (proposed):**

- **Keep the layout, add one top-level lane:** `knowledge/<bundle>/` for RKB bundles
  (first: `knowledge/software-engineering/` = the 105-subject hierarchy; later
  `knowledge/media-craft/` for gravitone). `skills/`, `practices/`, `memory/` stay as
  ascent designed them — skills migration (§4) fills `skills/` with real content.
- **Neutralize the manifest additively, don't rename:** keep `.ascent/registry.yaml` (ascent
  will follow and already reads it); add a top-level `registry.yaml` that is the
  vendor-neutral authority and declares `.ascent/` as ascent's overlay. Same move for
  `catalog.json`: keep the schema id for ascent compatibility, add a `bundles:` array for
  RKB entries — additive under the declared unknown-fields rule.
- **Replace the synthetic seed** with real content as lanes fill; move fixtures to
  `examples/` rather than deleting (ascent's indexer tests point at them).
- **Visibility: PUBLIC — resolved by the operator 2026-08-18.** The mechanism for
  internal references follows from that decision: **evidence with repo-internal references
  is split out of the published files into gitignored local sidecars** (see §2a). What
  publishes is the standard (golden paths, techniques) and the teaching material
  (application bodies); what stays local is the dense pointer layer into private code.

**Vocabulary collisions to settle at takeover (the one-authority fix from the plan):**

| axis | registry/ascent today | personas today | proposal |
|---|---|---|---|
| skill `category` | closed: `ci-cd, testing, security, ai-native, docs, workflow, other` | closed: `Development, Testing, Maintenance, Data, Other` | adopt the registry set (lowercase, richer); alias table maps personas values on first publish |
| skill `version` | semver `2.1.0` | `major.minor` all-digit, missing = 1.0 | adopt semver; personas versions migrate `X.Y → X.Y.0`; `parse_skill_version` accepts both during transition |
| memory `kind` | `episodic, semantic, procedural, summary` | (five vocabularies across two repos — see plan §4) | registry keeps ascent's four for `memory/`; the RKB door vocabulary (`observation/pattern/pitfall/decision/howto/fact` + status ladder) lives in `knowledge/` and is a different axis, documented as such in `registry.yaml` |

### 2a. The local-evidence sidecar (resolved design, from the operator's gitignore call)

Evidence today lives in each golden path's `evidence:` frontmatter — you cannot gitignore
lines inside a committed file, so the split becomes structural, and it unifies decision
№3 (deviation links) for free:

- **Published file** (`<subject>/<subject>.md`): frontmatter drops `evidence:` and
  `deviations:`; the body keeps the *prose* claims. Application bodies keep their
  file:line citations — they are teaching material about a public repo pattern, cited by
  path, and the operator has accepted public visibility for them; any application whose
  citations are genuinely private moves its citation block to the sidecar too.
- **Local sidecar** (`<subject>/.evidence.local.md`, matched by a registry `.gitignore`
  rule `**/.*.local.md`): carries `evidence:` (the dense pointers), `counter_evidence:`,
  and `deviations:` (the anchors into personas' deferred-fixes register). It lives only in
  clones that also have the cited repo — i.e., the operator's machines — enabling local
  cross-reference exactly as requested.
- **Checker split follows:** registry CI validates published files only (structure,
  purity, links, categories) and *requires the absence* of `evidence:`/`deviations:` keys
  in published frontmatter (a leak gate). Personas' `evidence-check` CI job reads the
  sidecars from its local clone and resolves the 721 pointers + 129 deviation anchors
  against its own tree — the gate keeps its teeth, split across the two homes.
- The Patterns-v2 reader treats a missing sidecar as "evidence: local-only, not present in
  this clone" — a labeled state, never an error (same graceful-absence posture the reader
  already has).

This also settles §5 decision 3: **consumer-overlay indirection wins over absolute URLs**,
because the sidecar IS the overlay and no public URL into personas is needed at all.

## 2. Impact map — what actually couples to `docs/concepts/paths/` (measured)

The full inventory is in the session transcript; the load-bearing facts:

**Breaks, ranked:**

1. **`hierarchy_read.rs:1470`** — `include_str!("../../../../docs/concepts/paths/table/table.md")`.
   Deleting `paths/` **stops `cargo build`**, not just runtime. Deliberate fixture pin; must
   be re-pointed (vendored fixture under `src-tauri/` test data) before deletion. The live
   integration test already self-heals on an absent corpus (`:1773-1782`).
2. **`check-corpus-integrity.mjs` §3.5** (`:202-407`) — the whole hierarchy gate (purity,
   bidirectional links, categories.json 4-way, evidence existence, corpus-map) lifts into
   registry CI, EXCEPT two cross-repo checks that must split:
   - **evidence existence** (`:329`): 721 evidence entries point at personas source files.
     Registry CI cannot check them (no personas checkout). Split: registry CI validates
     structure/purity/links/OKF; **personas CI keeps an `evidence-check` job that clones
     the registry and resolves evidence paths against its own tree** — the gate stays, it
     just changes home.
   - **corpus-map → golden-paths** (`:392`): the map references personas' legacy 247 (which
     STAYS in personas — census `rules.json`'s 202 `goldenPath` pointers all bind
     `golden-paths/`, zero bind `paths/`). Corpus-map is personas-specific bookkeeping →
     **corpus-map.json stays in personas** (moves out of `paths/` to `docs/concepts/`),
     becoming a consumer-side overlay mapping local legacy docs to registry subjects.
3. **129 outbound links** from `paths/**` bodies to `golden-path-deferred-fixes.md`
   (direction verified: deferred-fixes links only into `golden-paths/`, never into
   `paths/`). Deviations are per-consumer by design (they are PERSONAS' gaps against the
   shared standard) → the register stays in personas. At migration the 129 links rewrite
   to absolute GitHub URLs (`https://github.com/xkazm04/personas/... `if that repo is
   private, then to a documented consumer-overlay convention instead) — the RKB profile
   generalizes this as: **`deviations:` frontmatter names anchors in a consumer overlay,
   resolved by the consumer, opaque to the registry.** Same for the reader's
   `deferred_anchors` field (`hierarchy_read.rs:141`): resolves only when the consumer
   overlay is present, degrades to unresolved-count otherwise.
4. **`hierarchyModel.ts:253`** — a second hardcoded `docs/concepts/paths/` regex in the
   frontend despite the "reader is the ONE authority" comment. Rewire together with the
   reader constants; ideal fix is the reader returning already-classified link kinds so the
   frontend regex dies.
5. **`subject-index.json` (~860 path strings) + `build-paths-index.mjs`** — both git-UNTRACKED
   today. Decide home (registry — they index registry content) and commit there; regenerate,
   never patch.
6. **The seam that makes all of this easy:** `resolve_root()` (`hierarchy_read.rs:1299`)
   already resolves per-project from `dev_projects.root_path`, and the graph builder
   degrades gracefully on absent corpus. **Registering the registry clone as a managed
   project (or one `knowledge_root` setting) re-points the entire Patterns v2 UI with no
   architectural change.** `PATHS_REL` becomes `knowledge/software-engineering/` for
   registry roots — one constant + a root-kind flag.

**Non-breaks (verified, worth stating):** all 202 census rules · the golden-path Stop-hook
(`check-golden-path-touch.mjs`) · `.claude/CLAUDE.md`, `conventions.json`, `Design.md`
(golden-paths refs only) · **all `.claude/skills/*/SKILL.md` (zero references)** ·
`workspace_projection.rs` and the consult HTTP route (100% DB-library, never touch
`docs/concepts/`). **No agent-facing document routes to `paths/` yet — this is the
cheapest moment the move will ever have.**

## 3. Phased migration with the deletion gates made concrete

> ## ✅ P0 and P1 EXECUTED 2026-08-18
>
> **Registry:** `xkazm04/ai-registry` — [`00c1e26`](https://github.com/xkazm04/ai-registry/commit/00c1e26)
> (P0) and [`b9e0113`](https://github.com/xkazm04/ai-registry/commit/b9e0113) (P1), pushed.
>
> - **P0 shipped:** root `registry.yaml` (vendor-neutral lane declaration, `.ascent/` kept as
>   one consumer's overlay) · `docs/rkb-profile.md` (the OKF profile + layer contract) ·
>   `scripts/check-bundles.mjs` (zero-dep gate: OKF `type`, layer/type agreement, purity by
>   domain profile, bidirectional techniques, `@owner` sharing, application naming,
>   categories 4-way, link resolution, **the evidence leak gate**) ·
>   `scripts/build-catalog.mjs` (additive `bundles:` array) · `.github/workflows/knowledge.yml`
>   (two jobs: bundle integrity, catalog freshness) · `.gitignore` for `**/.*.local.md` ·
>   `knowledge/README.md` + README lane table. Example lanes untouched.
> - **P1 shipped:** 105 subjects / 624 techniques / 236 applications + `_laws.md` +
>   `categories.json` = **965 concept documents, 968 published files**. Gate green with the
>   **identical counts to source** and 3,638 links checked. 321 evidence key-blocks lifted
>   into 105 gitignored `.evidence.local.md` overlays (git `check-ignore` verified); 24
>   deviation-register references turned to prose; 26 escaping links turned into inline-code
>   citations. `catalog.json` carries the bundle at `sha256:abce7a1d86ee1c40`.
> - **The leak gate was fault-injected, not trusted.** Re-adding an `evidence:` key to a
>   published file fails the gate with the §5 message; restoring returns it to green.
> - **`docs/concepts/paths/` is byte-for-byte unchanged** and remains the authority. The
>   personas side of this work is four files: `scripts/registry/mirror-paths.mjs`, this doc,
>   `domain-knowledge-plan.md`, and the ledger entry.
> - **Deferred to P2 (unchanged):** `include_str!`, reader re-pointing, `hierarchyModel.ts`
>   regex, personas `evidence-check` CI. Owned by the concurrent Patterns-v2 session.
> - **One convention conflict resolved:** the registry's inherited "ASCII only" rule holds in
>   the three example lanes but every one of the 1,072 mirrored files carries Unicode
>   punctuation, and OKF mandates UTF-8. Scoped the rule to the example lanes rather than
>   mangling 965 documents.

> ## ✅ P2 EXECUTED 2026-08-19 — readers rewired, both halves of the gate running
>
> Personas commit: see the ledger. Registry: [`09a3cdd`](https://github.com/xkazm04/ai-registry/commit/09a3cdd).
> **The Patterns-v2 session closed before this ran, so P2 landed here rather than through it** —
> the coordination item recorded in §4 and §5 is discharged.
>
> **(a) `include_str!` un-coupled.** `hierarchy_read.rs` no longer compiles the corpus into
> the crate. `docs/concepts/paths/table/table.md` is vendored at
> `src-tauri/src/commands/infrastructure/fixtures/table-subject.md` and `include_str!`d from
> there, so deleting the tree at P4 fails a test instead of stopping `cargo build`. The pin
> did not become a snapshot agreeing with itself: `fixture_tracks_the_live_subject` asserts
> the copy is byte-identical to the live subject whenever one is reachable (whole file
> against the personas layout, body-only against a bundle, since the published file has no
> evidence keys).
>
> **(b) The reader reads a registry clone.** `discover_corpus()` finds either
> `docs/concepts/paths/` **or** `knowledge/<domain>/` (a bundle is identified by carrying
> `_laws.md` or `categories.json`, so an unrelated `knowledge/` folder is not mistaken for
> one). Every emitted path, the doc-read allowlist, and the mtime cache signature now follow
> the discovered layout instead of a literal — signing a fixed literal would have made every
> read of a clone a permanent cache miss. Two bundles is not an error but IS a choice, so the
> reader names the one it picked in a warning rather than deciding silently.
> **Verified against the real clone, not a fixture:**
> `PERSONAS_CORPUS_ROOT=…/ai-registry npm run test:rust` passes the real-corpus test.
> `HierarchySource` gained `corpusRel` / `docRootRel`; bindings regenerated.
>
> **(c) The duplicate path regex is gone.** `hierarchyModel.ts:255` carried
> `/^docs\/concepts\/paths\/([^/]+)…/` — the corpus location asserted in a second place, so
> a bundle-published corpus resolved *every* link to `null` while the UI rendered them as
> live. Link classification is now matched against the paths the reader actually emitted
> (`subject.file`, `technique.file`, `application.file`) and bounded by the roots it reported.
> Six new tests run the identical assertions against a `knowledge/software-engineering/`
> graph; 31 pass.
>
> **(d) `evidence-check` — the half of the gate that cannot move.** New
> `scripts/registry/evidence-check.mjs` + `npm run check:evidence` + a CI job that clones the
> registry. It resolves every `evidence:`/`counter_evidence:` path against this tree (**829
> links, all resolving**) and verifies **mirror parity as set equality, not counts** — two
> sets can agree on size and disagree on every member. Reports
> **105 / 624 / 236 on both sides**, which is the P4 gate-2 parity number measured rather
> than asserted. `--require-registry` turns a missing clone from a skip into a failure so a
> network blip cannot silently downgrade the job to half a gate.
> **Fault-injected five ways, all firing:** a removed bundle subject → parity failure naming
> it plus its 5 techniques and 2 applications; a re-added `evidence:` key → LEAK failure; a
> deleted overlay → partial-mirror failure; missing clone with `--require-registry` → exit 2;
> without it → skip printed OUT LOUD at exit 0.
>
> **(e) Index tooling registry-side.** `scripts/build-index.mjs` in the registry emits
> `knowledge/<domain>/index.json` (105/624/236/9 cited laws) so a consumer can read a bundle
> without personas. Only the *subject index* was portable: the personas generator's
> `router.json` maps evidence globs to subjects and its law index attaches evidence, and both
> are the evidence layer itself — a router built registry-side would be an empty file
> pretending to be an index. Those stay in `scripts/census/build-paths-index.mjs`.
>
> **Two things this uncovered, both fixed rather than noted:**
> 1. `hierarchy_reads_this_repos_real_corpus` **skipped silently** when the corpus was absent
>    (`if !…is_dir() { return }`) — the blind-instrument failure this repo has a doctrine
>    against, sitting inside the one test that reads real data. Absence is now tolerated only
>    when `PERSONAS_ALLOW_NO_CORPUS` says so out loud, and `PERSONAS_CORPUS_ROOT` lets CI aim
>    the test at a clone after the flip instead of deleting the test.
> 2. `evidence-check` was about to become this repo's **third** frontmatter parser, in a
>    codebase that pins two against each other with a committed fixture *because* two is
>    already a drift risk. The pieces `mirror-paths.mjs` had were extracted to
>    `scripts/registry/lib/frontmatter.mjs` and both scripts import them; the mirror's
>    dry-run output is unchanged (968 files, 321 lifts, 24 + 26 rewrites).
>
> **Still true:** `docs/concepts/paths/` remains the authority and is byte-for-byte
> unchanged. Nothing in personas *reads* the registry yet — P2 made it possible, P3 makes it
> so.
>
> **A finding that changes P4's framing, surfaced not decided:** `xkazm04/personas` is
> **PUBLIC**. The sidecar split therefore rests on *relevance* — evidence is noise to other
> consumers and would couple the standard to one tree — and not on secrecy, which is how
> §2a and rkb-profile §5 already argue it. But it also means the evidence layer can stay
> tracked and CI-checkable in personas after P4, which is what `evidence-check` assumes.
> **The gitignored overlays in the registry clone are a local convenience, not the archive.**
> P4 must not delete `paths/` until the evidence layer has a tracked home here.

**P0 — Registry takeover + spec (no personas changes).** Clear/relocate synthetic seed;
add `registry.yaml` (neutral authority) + `knowledge/` lane; write the RKB profile doc IN
the registry (from plan §5.1: OKF envelope, `x-rkb` extension, per-domain purity); port
checker §3.5 (minus the two cross-repo checks) + the categories 4-way gate into registry
CI (GitHub Actions, node, no deps — the checker is already dependency-free). Seed
CODEOWNERS with the operator.

**P1 — Mirror (personas stays authoritative).** Copy `paths/` →
`knowledge/software-engineering/` with the 129 deviation links rewritten per §2.3 and
`corpus-map.json` withheld (stays in personas). Registry CI green. Catalog generator
extended with `bundles:`. Personas gains a small `registry-mirror` script (rsync-style,
one direction) so the mirror can be refreshed until the flip. **Nothing in personas
consumes the registry yet; divergence risk is bounded by the mirror script being the only
writer.**

**P2 — Rewire readers (personas changes, coordinate with the Patterns-v2 session which
owns this code).** (a) `include_str!` fixture vendored; (b) reader root: registry clone
registered as the knowledge root (managed-project row or setting; the app clones/pulls via
git CLI — same trust posture as ascent: the app is never the write path, `git pull` is);
(c) `hierarchyModel.ts` regex removed in favor of reader-classified links; (d) personas CI
gains the `evidence-check` job (clone registry → resolve evidence); (e) `subject-index`
tooling committed registry-side. Parity gate: UI shows the same 105/624/236 from the
registry clone as from local docs.

**P3 — Flip authority.** Forge waves, improvements, and new subjects land as registry PRs
(merge = adopt, per CODEOWNERS); personas' `paths/` is frozen with a README pointer;
the mirror script reverses (registry → personas) or is retired outright.

**P4 — Verification gates, then delete.** The operator's "verified… without harm
(adoption, improvements, new items)" made checkable — ALL of:
  1. Registry CI green for the whole observation window (no structural drift).
  2. Patterns v2 UI reads exclusively from the registry clone at parity (105/624/236).
  3. **New item:** ≥1 new subject forged end-to-end as a registry PR (composer → PR →
     review → merge → visible in UI).
  4. **Improvement:** ≥1 technique edit round-trips (PR → merge → pull → UI reflects).
  5. **Adoption:** ≥1 second consumer reads the registry (ascent's indexer over
     `knowledge/`, or a sibling repo's session consulting the bundle by clone).
  6. Personas CI `evidence-check` green against the registry clone.
Then: delete `docs/concepts/paths/` from personas, leave `docs/concepts/paths.md` pointer
stub, keep `golden-paths/` + deferred-fixes + census untouched, update the 5 referencing
docs and `.claude/active-runs.md` convention.

**P5 — Skills migration (personas first, ascent follows).** The inventory found the
skills system is local-filesystem end to end — `global_skills_dir() = ~/.claude/skills`
(`skill_files.rs:225`), copy-based adopt/sync, hash-based drift, `publish_skill_to_library`
writing the home dir, `.personas-skill-meta.json` sidecar with a source *path*. Rewire:
  - The registry's `skills/` lane becomes the **org library**; `~/.claude/skills` becomes a
    **working copy of the registry clone** (the app pulls before scan; `global_skills_dir`
    gains a registry-clone tier ahead of the home tier).
    - ✅ **Sync before scan** — `dev_tools_registry_sync` (`registry_sync.rs`) fast-forwards
      the paired clone. Error-first by design, because the only reason to call it is to
      establish the clone is current: an **unreachable remote**, a **dirty tree** or
      **unpushed local commits** all reject rather than degrading, and the message names
      which of connectivity / mapping / local state to look at. Fast-forward only — never
      merge, rebase or stash a working copy other sessions and Ascent share.
    - Fires on an explicit **Sync** control in the workspace registry section, and
      automatically **before any share/adopt dispatch** (`syncBeforeDispatch` in
      `skillsWorkbenchData.ts`), where a rejection aborts the dispatch. Never on a render.
    - Ordering that is load-bearing: the usage piggyback is written **after** the sync,
      inside `runShare`. Writing it first (as the call site used to) dirties the tree and
      the sync would rightly refuse — every registry share would fail on the very check
      meant to protect it.
  - `publish` becomes **branch + commit + PR** (git CLI; the app proposes, the human
    merges — CODEOWNERS). `adopt`/`sync` stay copy-based from the clone; the provenance
    sidecar gains `source_commit` (SHA) beside `content_hash` — ascent's three-hash
    lockfile model (`in_sync|stale|diverged|local_only`) is the proven shape; port it.
  - `SYSTEM_SKILLS` stay installer-bundled as the offline seed (registry absence must never
    break the app — same graceful-absence posture as the hierarchy reader).
  - `skill_registry` DB stays a scan cache (it already is); `library_path` in
    `.personas/skill-registry.json` becomes `library_remote` + SHA.
  - Vocabulary: adopt registry categories + semver per §1's table.
  - ✅ ascent's R2/R3 registry slices then land against this same repo — the `catalog.json`
    skills entries are already its designed contract. **Satisfied**: `OrgRegistry`,
    map/create, the `skills/` indexer, `RegistrySyncStrip`, `origin` (`hosted | registry`)
    on the mirror rows and the migrate-PR route all exist in ascent today, and this arc
    pointed its `knowledge/` + `usage/` readers at the same repo. The bullet was about
    convergence — one registry, two consumers — not about new work here.

**P6 — Persona agents (later stage, per operator).** Generated personas have runtime
memory but no expert system. Connection design (sketch, to be its own plan):
  - ✅ **Consult lane — SHIPPED 2026-08-20** (`src-tauri/src/engine/knowledge_consult.rs`,
    injected in `engine/runner/mod.rs` immediately after the memory block, so the agent's
    own experience outranks generic doctrine when they disagree).
    - **A menu of pointers, not bodies.** 1,005 forged techniques is not injectable and a
      truncated technique reads as a complete one, so the section carries
      subject · technique · when-to-use · file path and invites the agent to open what
      applies. Same shrink the connector-usage sidecar already makes.
    - Budget 2,200 chars / 12 entries, packed whole — a deliberate fraction of memory's
      6,000, because memory is what *this* agent learned and the registry is speculative.
    - **The registry body is fenced as untrusted content.** Anyone who can merge into a
      shared registry writes subject names, technique names and `use_when` strings that
      this app copies verbatim into every persona's prompt. So the body goes inside the
      nonce'd `<untrusted_*>` boundary the runtime canary already explains, via a new
      `prompt::wrap_untrusted_section` — the fence helpers are `pub(super)`, so text
      appended to a finished prompt could not be fenced even in principle. The app's own
      framing stays OUTSIDE the fence; fencing the sentence that explains the boundary
      would tell the model to distrust it. Asserted structurally, because the failure —
      text appended raw past the canary — looks completely normal in a diff.
      **The census rule `prompt-extended-outside-its-assembler` is what caught this**, on
      the first run after the code was written.
    - Framing is also asserted: registry doctrine does not override the task or the user.
    - The settings key is spelled **once, in Rust**. The store calls
      `dev_tools_set_knowledge_root(path | null)` rather than writing
      `app_settings` directly, so there is no TypeScript copy of the key name to drift —
      and no second Rust declaration either (`knowledge_consult` re-exports
      `settings_keys::KNOWLEDGE_REGISTRY_ROOT` rather than restating it). Both were real
      defects on the first draft, both caught by census rules
      (`settings-key-declared-outside-registry`, `comment-kept-cross-language-mirror`).
    - **Graceful absence throughout**: no wiring, a stale path, an unbuilt or malformed
      `index.json` all leave the prompt byte-for-byte unchanged.
    - **The runner learns the path from `app_settings['knowledge_registry_root']`**, mirrored
      from the workspace registry store's single `commit` choke point. localStorage cannot
      be read from Rust and a 3am schedule has no window to ask. One root for now; the
      per-project mapping is the next slice.
  - ⚠️ **`use_when` — the designated selection key — covers 376/1005.** Measured
    2026-08-20: 100% in `civic-intelligence`, `grant-funding`, `llm-observability` and
    `media-generation`; **0/629 in `software-engineering`**, the bundle a coding persona
    needs most. A slug/category fallback covers the gap and is genuinely weaker (a name is
    not a situation), so every pick records its selector and the runner logs the split —
    the gap is observable rather than inferred from disappointing output.
    **Backfilling `use_when` across `software-engineering` is the highest-value next
    step for this lane**, and needs no code change to take effect.
    - A relevance floor came out of running the selector against the real corpus rather
      than fixtures: without it, one shared *category* word pulled 11 irrelevant techniques
      in behind a single genuine match. Fixtures could not have caught it; the
      `#[ignore]`d `smoke_against_the_real_registry` test is what did.
  - **Propose-upward lane:** persona executions that surface generalizable lessons emit
    candidates through the EXISTING harvest door shape (`result.json` → governed ingest →
    human adjudication), tagged `source: persona-execution` — nothing auto-adopts.
  - Non-coding domains slot in the moment their bundle exists (`knowledge/media-craft/`
    for a gravitone-flavored persona) — the mechanism is domain-blind by construction.

## 4. Risks and their controls

| Risk | Control |
|---|---|
| Public registry exposes personas internals via Application citations | Deviations stay in personas (§2.3); operator confirms visibility before P1, or repo flips private |
| Two authorities during P1–P2 (personas docs + registry mirror) | One-direction mirror script is the only writer; flip in P3 is atomic (freeze + README) |
| Concurrent Patterns-v2 session owns `hierarchy_read.rs` | P2 lands through that session or after explicit handoff — ledger entry required |
| `cargo build` breakage on deletion | `include_str!` fix is a P2 item, gated before P4 deletion; the checker's own instrument-assertion doctrine applies |
| Registry CI weaker than personas' gates | Registry CI ports the SAME checker sections; evidence check stays consumer-side, explicitly documented as split, not dropped |
| Skills publish gains a network dependency | Publish degrades to local + queued PR when offline; SYSTEM_SKILLS bundled seed unchanged |
| ascent divergence resumes | ascent R2/R3 target this repo; the neutral `registry.yaml` + additive catalog keep its reader working unchanged |

## 5. Operator decisions — ALL RESOLVED 2026-08-18

1. **Registry visibility: PUBLIC.** Internal references live in gitignored local sidecars
   (§2a) for local cross-reference; they don't publish.
2. **Lane naming: `knowledge/<domain>/`** — first bundle `knowledge/software-engineering/`,
   later `knowledge/media-craft/`. Skills/practices/memory lanes unchanged.
3. **Deviation-link convention: consumer-overlay** via the same `.evidence.local.md`
   sidecar (§2a) — no public URLs into personas needed.
4. **Gates: event-based**, no calendar window — exercised directly in LLM CLI sessions
   (a session forges the new subject via PR, runs the improvement round-trip, drives the
   second-consumer read; each gate is a session deliverable, not a waiting period).

**P0 is unblocked.** Remaining coordination item: P2 lands through (or after handoff from)
the concurrent Patterns-v2 session that owns `hierarchy_read.rs`.
