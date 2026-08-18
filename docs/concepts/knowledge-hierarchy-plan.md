# Knowledge hierarchy plan — v2

**Status:** v1 ratified 2026-08-18 at the close of the 247-leaf composition campaign;
**v2 recalibrated the same day by the operator** on three points that change the design
(granularity, sourcing, graph freedom). **Executor:** the next Fable session and its
waves. This document is the handoff — read it before touching anything under
`docs/concepts/golden-paths/`.

---

## 0. Verdict (unchanged from v1)

The design was a four-layer hierarchy — **Golden Paths → Techniques → Applications →
Evidences** — and the campaign produced 247 documents that are Applications fused with
Evidences, labeled Golden Paths. The two upper layers were never built.

Proofs from inside the corpus: `golden-path-doctrine.md` is the *accidental*
transferable layer (it transplants to any sibling repo unchanged; no leaf document
does), and **121 of 201 census rules carry an explicit "must be re-derived per repo"
precondition clause** — the composers knew they were writing Applications; the design
had no layer above to receive the general half.

Root causes, still binding on this plan: (1) the layer boundary was the one ungated
invariant, and ungated invariants flatten; (2) the spine taxonomy is surface-first;
(3) the census rule was the mandated apex deliverable; (4) the 0%-precision lesson
over-generalized from "never write a *gate* from principle" to "never abstract at all".

## 1. The v2 recalibration (operator, 2026-08-18) — three corrections to v1

**1. Granularity: a Golden Path is a named engineering SUBJECT, not an abstract
mechanism.** The calibration example, verbatim structure:

| Layer | Example |
|---|---|
| **Golden Path** | **Table** |
| **Techniques** | performance, pagination, sorting, UX, client/server roles |
| **Applications** | React/Next coding approaches (and the Rust/server equivalents) |
| **Evidence** | the manifestation in the codebase — e.g. the universal table component in Personas — **kept sparse so evidences never overflow** |

v1's twelve-to-twenty mechanism-shaped candidates ("one authority per vocabulary", "a
gate must see its target") were **mis-leveled** — those are cross-cutting laws, not
subjects (see §2, "Cross-cutting laws"). A repo with 7,000+ commits across React and
Rust spans far more than 20 subjects. **Do not pre-commit to a count; the fresh scan
decides.** Plausible order of magnitude: 40–80.

**2. Sourcing: scan again from scratch, and forge through the LLM hardening layer.**
v1 was distillation-only from the 247 corpus. v2 has two sources and one forge:

- The **repo names the subjects** (fresh scan, §3) — the corpus is a *secondary* input.
- The **LLM writes the standard**: every Golden Path and Technique is authored from the
  composer's own expert software-engineering knowledge first, then reconciled against
  evidence. The repo's current practice is never the ceiling of the content — per the
  operator's standing direction ("LLM as expert developer forges it into golden path as
  its sw engineering skills can always produce code on higher quality level than me or
  potential user"). Where the repo falls short of the forged standard, that is a
  **deviation** registered as a gap, not a reason to lower the standard.
- **Evidence keeps it honest**: curated pointers to the canonical manifestation,
  confirming or contradicting the standard.

**3. The graph itself is open for redesign.** The spine's surface-first shape must not
leak into the new hierarchy — reconsider the node structure from zero if it locks the
design (§5). The spine is demoted to a legacy index of the old corpus.

## 2. Layer contract v2

Acceptance tests per layer — their absence was root cause #1 and this table is the gate.
The Table row above is the running calibration for every forge brief.

| Layer | Answers | Acceptance test |
|---|---|---|
| **Golden Path** | *What this subject is, and what a principal engineer holds true about it.* A named engineering subject (Table, Modal & overlay stack, Form, Scheduling & triggers, Streaming model output, Credential vault, Undo & history, Search, Migrations, Background jobs, Release pipeline…). | **Existence criterion:** the subject manifests in this repo (≥1 real surface or subsystem) — *this replaces v1's "≥3 measured instances" distillation rule, which wrongly bounded content by repo instances.* **Transplant test:** the body contains zero repo identifiers, file paths, or framework names — an agent in a sibling repo can use it unchanged. Evidence lives in links, never inline. |
| **Technique** | *A named concern of its subject, with the procedure and decision rules.* (For Table: pagination, sorting, performance/virtualization, UX states, client/server responsibility split.) | Language-agnostic; transplant test applies. Belongs to one Golden Path (cross-references allowed; shared-technique nodes are a graph-design decision for session N+1, §5). |
| **Application** | *How you realize the technique on a concrete stack.* One per stack where relevant: React/TS client, Rust backend, SQL. Census rules live here. | Cites real code; any *measured* claim keeps the full v1 discipline (two implementations, positive controls, hand-verified precision). The existing 247 documents are pre-built members of this layer. |
| **Evidence** | *Where the practice manifests.* | **Curated and sparse by policy**: the canonical manifestation (e.g. `UnifiedTable`) plus at most a key counter-example. The 247-document corpus and the census baselines are the *deep archive behind* these pointers — linked, never restated. |

**Cross-cutting laws (reclassified from v1 §8).** The nine v1 candidates — one authority
per vocabulary; a gate must see its target; failure spelled differently from empty
success; identity survives reordering/reuse/restart; a stored derivation names its
recomputation; one validation door + enumerate writers; a count carries its predicate;
deletion is not repair; everything created names its reaper — are **laws that Techniques
cite**, not Golden Paths. They live with the doctrine (largely already written there)
and get stable anchors so any Technique can reference them. They are real convergences,
measured ≥3 times each; they were just the wrong *kind* of node.

**Scope of the 0%-precision lesson, settled:** it governs **gates and measured claims**
(census rules, baselines, precision figures) — unchanged and non-negotiable. It does
**not** govern principle content; Golden Paths and Techniques are authored from
expertise. The two meet at the deviation record. This resolves the tension v1 papered
over.

## 3. Two sources, one forge

**Source A — the fresh scan (primary).** Enumerate the repo's engineering subjects from
scratch:
- Waves over the context map (16 groups / 208 contexts) naming the subjects each context
  embodies, plus a commit-history theme pass (7,000+ commits) for subjects the map
  under-represents (build/release, process management, parallel-session workflow).
- **Lock-in guard:** scanners do NOT read the spine or the 247 corpus before naming
  subjects — the old taxonomy must not shape the new inventory. The corpus is consulted
  *after*, as a coverage cross-check (a corpus leaf with no home in the new inventory is
  either a missed subject or an Application looking for its topic).

**Source B — the corpus (secondary).** The 247 documents are the Application inventory,
the deviation mine, and the evidence archive. They are mapped INTO the new graph
(upward links), never used as its skeleton.

**The forge — two-phase, per Golden Path:**
1. **Expert draft** (the LLM hardening layer): write the subject's best practice and its
   Techniques from engineering knowledge, before opening repo code. This is what keeps
   the content at altitude — the corpus's gravity pulls toward Application detail, and
   phase 1 is deliberately out of its reach.
2. **Evidence reconciliation:** open the repo. Each claim gets one of three outcomes —
   **confirmed** (link the canonical evidence), **deviation** (repo falls short of the
   standard → registered gap in `golden-path-deferred-fixes.md` or the backlog; the
   standard stays), or **upward lesson** (the repo teaches something the draft lacked —
   this happens; the trigger fix and the isolated-index commit ritual are both examples
   of repo practice exceeding textbook practice).
3. **Transplant test:** hand the Golden Path + Techniques to an agent in a sibling repo
   (`brainiac`, `vibeman`, `ascent`) with no Personas access; it must locate the subject
   and sketch an Application there without questions. A failed transplant demotes or
   revises the document.

## 4. What survives from v1 unchanged

The diagnosis and root causes. The census and all 201 rules exactly as they are
(Application-layer enforcement, healthy). The 247 documents stay on disk — renamed in
role, not moved; moving breaks 4,000 links and 201 `goldenPath` pointers. The
verification method for anything measured. The integrity-checker gating of layer
boundaries (§5) — root cause #1 must stay answered. The isolated-`GIT_INDEX_FILE`
commit ritual under parallel sessions. Measurement against the 2026-08-17 pre-purge
backup for any historical row-count claim.

## 5. Graph and artifacts — designed fresh in session N+1, not inherited

Per the operator: reconsider the node hierarchy in case it locks thinking. So the graph
design is the next session's **first deliverable**, made deliberately, with these
constraints rather than a prescribed tree:

- Four layers with machine-checkable membership and links (frontmatter or header
  blocks) in both directions.
- A proposal to evaluate — one folder per subject:
  `docs/concepts/paths/<subject>/{<subject>.md, techniques/*.md, applications/*.md}` —
  but the session may overrule it; decide shared-vs-owned Technique nodes (pagination
  appears under Table and under Feed) explicitly at design time.
- `docs/concepts/golden-paths/` keeps its path as the legacy archive/Application layer;
  a mechanical rename can come later.
- `situation-spine.json` retired as organizer; retained for corpus indexing and census
  integrity.
- **Extend `check-corpus-integrity.mjs`** to gate the hierarchy: Golden Path / Technique
  bodies containing repo paths or framework names → fail; an Application without an
  upward link (post-pilot) → fail; a Golden Path with zero evidence links → fail;
  unresolvable links → fail. The checker cannot run the transplant test; it refuses the
  statically checkable violations and *says* what it cannot check.

## 6. Applying to contexts

Unchanged in intent, now computable: join census match sites against `context-map.json`
`filePaths` → per-context scorecard (which subjects are live here, through which
Applications, with counts; emitted like `census-rules-report.csv`). A session working in
context X loads the subject bundles live in X — selective loading by subject is the
payoff the flat corpus could not provide. Size per-context work off the app's context
map, not the committed Vibeman snapshot (the 5× sizing error of 2026-07-29 stands as
the warning).

## 7. Session plan

**Session N+1 (next Fable session):**
1. Ratify this contract (§2) with the operator — the Table row is the calibration.
2. **Design the graph** (§5) — fresh, explicitly free to break from the old shapes.
3. **Fresh subject scan** (§3 Source A) → candidate Golden Path inventory; operator
   gates the list. Then the corpus coverage cross-check.
4. **Pilot: forge "Table" end-to-end** — the operator-specified worked example. Expert
   draft → Techniques (pagination, sorting, performance, UX states, client/server
   roles) → Applications (React: the `UnifiedTable` conventions and loading-v2 laws;
   Rust/SQL: query shape, keyset pagination — `team_assignments.rs:392` is the repo's
   own compliant exemplar) → sparse Evidence links → deviations registered. Then one
   backend-native subject (e.g. **Scheduling & triggers** or **Background jobs**) to
   prove the contract on Rust ground.
5. Extend the integrity checker and land it green.

**Sessions N+2…:** forge waves by subject, exactly as the composition campaign ran —
batched composers, operator-gated inventories, verify by exit code, corrections as
first-class deliverables. Backfill upward links from the 247 Applications as their
subjects come online. Generate the context scorecard. Closing pass: the doctrine
donates its transplantable sections to the cross-cutting-laws anchors.

## 8. Anti-lock guards

- The subject inventory comes from the **code**, not from the spine or the corpus;
  those are cross-checks.
- Census-rule availability must not shape what becomes a Technique — plenty of real
  Techniques are absences the census structurally cannot express (measured: the 0%/100%
  prevalence limitation), and they are Techniques all the same.
- Evidence sparse by policy — one canonical pointer beats ten measurements; the archive
  holds the rest.
- The next session may overrule this document's structural proposals; the graph design
  is its deliverable, not its inheritance. What it may not overrule: the four layers,
  their acceptance tests, and the gated boundary.

---

*The lesson v1 recorded, still in force:* **the layer boundary was the one invariant
without a gate, and ungated invariants flatten.**

*The lesson v2 adds:* **the repo names the subjects; the LLM writes the standard;
evidence keeps it honest** — distillation alone produces a mirror of the repo, and a
mirror cannot hold a repo to a standard higher than itself.
