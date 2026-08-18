# Knowledge hierarchy recovery plan

**Status:** ratified by the operator 2026-08-18, at the close of the 247-leaf composition
campaign. **Executor:** the next Fable session (and its waves). This document is the
handoff — it carries the diagnosis, the layer contract, the forging procedure, and the
session plan. Read it before touching anything under `docs/concepts/golden-paths/`.

---

## 0. Verdict

The design was a four-layer hierarchy:

> **Golden Paths** (high-level engineering situations and their best practice)
> → **Techniques** (procedures for how to solve them)
> → **Applications** (language/repo-specific solutions)
> → **Evidences** (measurements, replays, incidents)

The campaign produced **247 documents that are Applications fused with Evidences**, labeled
Golden Paths. The two upper layers were never built. This is a design failure, not a quality
failure — the bottom layers are excellent and are the ore the upper layers get forged from.

Two proofs from inside the corpus:

- **The doctrine is the accidental Golden-Path layer.** `golden-path-doctrine.md` — "a
  reconciliation is a claim", "a diff-shaped gate is blind to an absence", "prefer a type
  over a gate" — transplants to any sibling repo unchanged. No leaf document does. The only
  transferable layer we produced accreted by accident, because generality had nowhere else
  to live.
- **121 of 201 census rules carry an explicit `PRECONDITION (must be re-derived per repo)`
  clause.** The composers knew they were writing Applications and marked the boundary; the
  design had no layer above to receive the general half.

## 1. Root causes (rank-ordered; the plan must answer each)

1. **The layer boundary was ungated.** Every layer below had acceptance tests (two
   implementations, positive controls, hand-verified precision). "Is this a Golden Path or
   an Application?" had none. The corpus optimized for what was checked — the campaign's own
   headline theme, pointed at itself.
2. **The spine taxonomy is surface-first.** `situation-spine.json` organizes by product
   surface (`lists-and-tables`, `overlays`, `build-profiles`). Surfaces are where
   Applications live; problems are where Golden Paths live. One-doc-per-surface-leaf can
   only produce Applications, and the same mechanism was measured 5–10 times across leaves
   with no single home (measured: two rules found with "recall gaps of the same shape" by
   different composers; four denominators that shrank by deletion, each discovered
   separately).
3. **The census rule was the mandated apex deliverable.** §9's rule-or-decline made a
   repo-specific regex the crown of each document.
4. **The 0%-precision lesson over-generalized.** "Never write a gate from a principle before
   reading the code" (correct, measured twice) silently became "never abstract at all". The
   fix is not abstraction-first — it is abstraction **after ≥3 measured instances**, which
   the corpus now makes possible for the first time.

## 2. The layer contract (the piece that was missing)

Adopt the operator's four terms verbatim. Each layer gets an acceptance test a reviewer can
run — the absence of these tests is root cause #1.

| Layer | Answers | Acceptance test |
|---|---|---|
| **Golden Path** | *What must be true, and why.* Names an engineering situation and its governing principle. | **Transplant test:** contains zero repo identifiers, zero file paths, zero language or framework names. Hand it to an agent in a sibling repo (`brainiac`, `vibeman`, `ascent`) with NO access to Personas code — the agent must be able to recognize whether the situation exists there. **Forge criterion:** may only be created when the same mechanism has been measured in ≥3 Applications across ≥2 surfaces (or 2 Applications + 1 sibling-repo instance). A Golden Path with one Application is that Application renamed. |
| **Technique** | *How you make it true.* A procedure with steps and decision rules; mechanism-specific but language-agnostic (may name classes of tools: a ratchet, a closed generated vocabulary, an isolated index, a partitioning control). | **Transplant test, weaker form:** an agent in a sibling repo, given only the Technique, must be able to produce a correct Application there without asking questions about Personas. Belongs to exactly one Golden Path. |
| **Application** | *What you type here.* The repo/language-specific realization — the census rule, the exact type edit, the file:line prescription. | This is what the existing 247 documents and 201 rules already are. Test: cites real files, reproduces its baselines, hand-verified precision. Links upward to ≥1 Technique. |
| **Evidence** | *How we know.* Measurements, replays, incidents — dated, with the instrument that produced them. | Already embedded in the 247 documents and the deferred-fixes register. Test: names its instrument, its denominator's source, and its date. Stays physically inside the Application documents; the upper layers cite downward, never restate. |

**The litmus pair, from our own corpus:** `golden-path-doctrine.md` §"A reconciliation is a
claim" passes the Golden-Path transplant test. `schedule-calendar.md` fails it in its first
sentence. Use these as the calibration examples in every forge brief.

## 3. What survives unchanged, what changes

**Keep (proven this campaign):** two independent implementations of every count; positive
controls that partition the anchor; hand-verification of matches; verify-by-exit-code,
never through a pipe; corrections-as-first-deliverable; the census runner and all 201 rules
exactly as they are (they are the Application-layer enforcement and they are healthy); the
deferred-fixes register; the doctrine; the isolated-`GIT_INDEX_FILE` commit ritual under
parallel sessions; measurement against the 2026-08-17 pre-purge backup for any row-count
claim.

**Change:**
- The 247 documents are **renamed in role, not moved on disk**: they become the
  Application+Evidence layer. Physically moving them breaks 4,000 links and 201
  `goldenPath` pointers in `rules.json`; instead each gets a small upward-link header
  (see §5). A mechanical directory rename can come later, once the hierarchy is stable.
- The word "golden path" stops referring to leaf documents. New top-layer docs own the term.
- §9's mandate changes from "rule or decline" to "rule or decline, **and name the
  Technique this realizes"** for future compositions.
- The spine stays as the Application index (it is a good map of surfaces); the new
  hierarchy is problem-first and cross-cuts it. Do not rewrite the spine.

## 4. The forging procedure (mining, not rewriting)

The upper layers are **distilled from the existing corpus**, never written fresh from
principle — that is the 0%-precision lesson applied correctly.

**Inputs, all machine-readable already:**
- `docs/concepts/golden-paths/index.json` — 247 docs with headline + §2 oneWay + ruleIds digests
- `scripts/census/rules.json` — 201 rule descriptions (each is nearly a Technique statement)
- `docs/concepts/golden-path-deferred-fixes.md` — 127 named defects
- The doctrine — pre-forged Golden-Path material for the meta/verification cluster
- The §12 cross-corrections — every "same shape as" is a clustering edge

**Procedure per wave:**
1. **Cluster** Applications by *mechanism*, not surface. Work from index digests + rule
   descriptions, opening full documents only to resolve a doubtful membership. An
   Application may belong to multiple clusters (a leaf usually realizes 2–4 mechanisms).
2. **Gate the cluster map with the operator** before forging — the taxonomy is a product
   decision (this is the step the original campaign skipped).
3. **Forge**: for each ratified cluster, one composer writes the Golden Path (≤1 page) and
   its Techniques (50–150 lines each), citing the member Applications and their Evidence
   downward. The composer is an *engineer synthesizing*, not a scanner — per the operator's
   standing direction, the forged best practice may exceed what the repo currently does;
   the repo's current shape becomes a deviation, not the standard.
4. **Transplant-test** every forged Golden Path and Technique against ≥1 sibling repo:
   dispatch an agent into `brainiac` or `vibeman` with only the new document; it must
   locate the situation (Golden Path) or produce an Application sketch (Technique) without
   reading Personas. A failed transplant is a failed forge — revise or demote the document
   to the layer it actually is.
5. **Wire links** (see §5) and run the extended integrity checker.

**Expected shape** (estimate, to be confirmed by clustering): 247 Applications → **30–50
Techniques** → **12–20 Golden Paths**.

## 5. Artifact layout, link schema, enforcement

```
docs/concepts/
  principles/            <- Golden Paths (new; ≤1 page each; zero repo identifiers)
  techniques/            <- Techniques (new; 50–150 lines; language-agnostic)
  golden-paths/          <- existing 247 docs = Applications+Evidence (path kept; role renamed)
  golden-path-doctrine.md  <- method doctrine; source material for the verification cluster
```

Each Application gains a header block:

```markdown
> **Layer: Application.** Realizes technique(s): [[closed-generated-vocabulary]], …
> Golden path(s): [[one-authority-per-vocabulary]], …
```

Each Technique names exactly one Golden Path; each Golden Path lists its Techniques and
Applications.

**Extend `check-corpus-integrity.mjs` to gate the hierarchy** — this is the structural
answer to root cause #1. New failures:
- an Application with no upward Technique link (grandfathering: fail only for docs touched
  after the pilot wave; a backfill wave wires the rest);
- a Technique whose Golden Path does not exist, or that belongs to more than one;
- a Golden Path with fewer than 3 member Applications (the forge criterion, enforced);
- a Golden Path or Technique containing a repo path (`src/`, `src-tauri/`, `scripts/`), a
  file:line citation, or a language name — the transplant test's cheap static half. The
  checker cannot run the transplant itself; it can refuse the obvious violations, which is
  exactly the "absence-blind gate" lesson: gate what is checkable, *say* what is not.

## 6. Applying to contexts (the third leg)

Once Techniques exist, "applying to contexts" becomes computable rather than editorial:

- **Per-context scorecard:** join census match sites (the runner already knows every file
  each rule matches) against `context-map.json` `filePaths` → for each of the app's
  contexts: which Golden Paths are live here, through which Applications, with counts.
  Emit as a generated artifact (`docs/concepts/context-scorecard.json` + a CSV like
  `census-rules-report.csv`).
- **Session loading:** a session working in context X reads the scorecard and loads only
  the Golden Paths and Techniques live in X — the hierarchy is what makes that selective
  loading possible at all; the flat corpus could not be loaded selectively by problem.
- Size per-context work off the **app's** context map (the database authority), not the
  committed Vibeman snapshot — the 5× sizing error of 2026-07-29 is the standing warning.

## 7. Session plan

**Session N+1 (first Fable session on this plan):**
1. Ratify §2's layer contract with the operator (10 minutes of gates, then binding).
2. Run the clustering pass over the machine-readable inputs → proposed cluster map
   (candidate Golden Paths with member Applications). Gate with the operator.
3. Forge **2–3 pilot clusters end-to-end** — Golden Path + Techniques + upward links on
   their member Applications + a real transplant test against one sibling repo. Strong
   pilot candidates: *gate integrity* (the doctrine has pre-forged most of it) and *one
   authority per vocabulary* (the TriggerKind fix is a complete worked example).
4. Extend the integrity checker (§5) and land it green.

**Sessions N+2…:** waves, as this campaign ran them — forge remaining ratified clusters,
backfill upward links on all 247 Applications, generate the context scorecard, then a
closing pass that re-audits the doctrine and migrates its transplantable sections into
`principles/` where they belong.

## 8. Candidate Golden Paths (seed list — clustering must confirm, operator must gate)

Extracted from convergences the campaign already measured ≥3 times each. Titles are
problem-shaped and repo-free on purpose:

1. **One authority per vocabulary** — every closed set of names has exactly one declaration
   that generates all consumers (storage constraint, client menu, classifier,
   translations). *Members incl.:* the TriggerKind fix, status tokens, the SQL-verb
   vocabulary rule, connector kind menus.
2. **A gate must be able to see its target** — enforcement level, recall against the real
   spelling population, absence-blindness of diff-shaped checks, self-counting gates,
   fixtures that cannot fail. *Members incl.:* enforce-base-modal, the doc-sync hook,
   cargo-deny, binding drift, notificationCoverageGate, the eval lane.
3. **Failure must be spelled differently from empty success.** *Members incl.:*
   failure-written-as-empty-list, probe-verdict-narrowed-to-boolean, $0-vs-unpriced,
   vacuous-all-done-verdict, null-spinner busy states.
4. **Identity must survive reordering, reuse, and restart** — keys, selection, PIDs, cell
   coordinates, ordering tie-breakers. *Members incl.:* PID-without-start-time, grid
   identity lost above the renderer, clock-ordered reads without tiebreak, media src
   without remount key.
5. **A stored derivation must name its recomputation** — every scalar shadowing a
   computation drifts. *Members incl.:* next_trigger_at, updated_at destroyed as an
   oracle, freshness notes, denormalized counts.
6. **One validation door, and enumerate the writers first** — the defect is in a writer
   nobody listed, not the door everyone reads. *Members incl.:* validate_all, raw-JSON
   editors, build-session raw SQL, seed clobbering.
7. **A count is meaningless without its predicate** — namespace, denominator, and question
   travel with every number. *Members incl.:* the citation-namespace sweep, 6-vs-135
   spawn sites, conjoined headlines, the fabricated reconciliation.
8. **Deletion is not repair** — a shrinking population must name its cause; a ratchet
   stores the same number either way. *Members incl.:* the four deletion-shrunk
   denominators of 2026-08-17.
9. **Everything created names its reaper** — layouts, vectors, versions, worktrees, seeds;
   a store that can only grow is the defect. *Members incl.:* orphaned vectors, canvas
   layout entries, worktree GC, "nothing has ever deleted a row" ×3.

Clusters 2, 7 and 8 draw heavily on the doctrine — expect the doctrine to *donate* sections
to `principles/` rather than being duplicated.

---

*Why this failed the first time, in one sentence, for the next session to keep in view:*
**the layer boundary was the one invariant without a gate, and ungated invariants flatten**
— the corpus optimized for exactly what its contract checked, and transferability was
never checked.
