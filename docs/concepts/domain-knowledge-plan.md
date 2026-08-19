# Domain knowledge bases — analysis and design (v0)

**Status:** analysis + proposal, 2026-08-18, forked from the hierarchy-v2 session at 82/85
forged subjects. **Question from the operator:** the golden-path hierarchy nailed
granularity, production (two-phase forge), expert review, and adoption — for *software
engineering*. What do we do with (1) other business domains (e.g. gravitone's AI content
craft: video cutting, storytelling, camera, image-prompt composition) and (2) the memory
systems the personas themselves run on, whose hierarchies are nowhere near the golden-path
structure — some of whose domains may even be coding? Two research leads were mandated:
OpenWiki's agentic-documentation design, and a third-party knowledge registry/repo model
as ascent prototyped in its Skills / Memories tabs.

Everything below is grounded in three scouting passes done for this document: OpenWiki +
the Open Knowledge Format spec (web), ascent's Skills/Memory/Registry implementation
(`C:\Users\mkdol\dolla\ascent`, file:line cited), and the five knowledge systems inside
Personas as actually implemented (file:line cited). Sources are listed in §9.

---

## 0. Verdict in one paragraph

**The four-layer contract transplants; the subject inventory does not.** Golden Path →
Technique → Application → Evidence is a *knowledge shape* (principle / procedure /
stack-realization / witness), and gravitone's craft fits it exactly (Golden Path "Cut &
pacing" → Techniques "J-cut / L-cut", "cut on action" → Application "in this NLE, on this
footage" → Evidence "these three clips"). What does NOT transplant is the 85-subject
inventory, the purity denylist (which is stack-specific), and the *evidence layer's
substrate* — a code repo has file:line; a content domain has assets and outcomes.
**The Personas memory systems are a different animal**: they are *runtime* memory
(episodic/decaying/budgeted, per-agent), not *reference* knowledge, and forcing them into
the golden-path tree would be the same category error the v1 corpus made in reverse. The
right move is a **shared file-level format for the reference tier only** — an OKF-shaped
markdown bundle with our four layers expressed as `type:` — that Personas, ascent, and any
future consumer read the same way, with each app's runtime memory feeding INTO it through
one governed door (consolidation/harvest) rather than being replaced by it. The registry
question resolves cleanly: **yes, and the format is the standard, not the registry** —
ascent's git-native design and OKF converge on "a folder of markdown with frontmatter that
anyone with `git` can ship and anyone who can open a file can read"; Personas already runs
its two most portable systems (companion brain, skills) exactly this way.

---

## 1. What the golden-path campaign actually settled (and what it silently assumed)

The v2 contract's transferable core (`knowledge-hierarchy-plan.md` §2, `paths/GRAPH.md`):

| Layer | Answers | Transferability |
|---|---|---|
| Golden Path | what a principal *practitioner* holds true about a subject | **domain-agnostic** — "principal engineer" is one instance of "principal practitioner" |
| Technique | a named concern with procedure and decision rules | domain-agnostic |
| Application | how you realize it on a concrete *stack* | needs a domain-specific notion of "stack" |
| Evidence | where it manifests | needs a domain-specific *substrate* |

Three things the campaign settled that are pure method and carry over unchanged:

1. **The two-phase forge** — expert draft *before* opening the corpus, then reconcile to
   confirmed / deviation / upward-lesson. This is what kept content above the repo's own
   ceiling. Nothing about it is code-specific.
2. **The gated boundary** — layer membership machine-checked (frontmatter + location +
   bidirectional links), because "the layer boundary was the one ungated invariant, and
   ungated invariants flatten." The *checker* is reusable; its purity denylist is not.
3. **Owned techniques, cross-referenced** (`pagination@table`), laws as cited anchors,
   evidence sparse by policy, deviations registered not applied.

Three things it silently assumed that a domain KB must re-decide:

- **The subject scan reads a codebase.** For gravitone the scan reads *the craft* — its
  tools, its outputs, its professional literature — and the "commit-history theme pass"
  becomes "the project's own body of produced work."
- **Purity = no repo paths / no stack names.** For a content domain the analogue is "no
  project-specific asset ids / no tool product names in the golden-path and technique
  layers" — the *principle* (transplantable to a sibling studio) holds; the denylist is
  domain-authored.
- **Evidence = file:line.** In content domains evidence is an *asset + an outcome* (this
  cut, this render, and what it scored / how it performed). That is a stronger evidence
  substrate than code has, not a weaker one — it carries a measurable outcome.

## 2. Two very different targets — treat them separately

The operator's two cases are not siblings; they are different tiers.

### 2a. Business-domain knowledge (gravitone-class) is REFERENCE knowledge

It is authored, reviewed, slowly-changing, and shared across practitioners. It has exactly
the shape the golden-path hierarchy was built for. Its subjects come from the craft, and
a plausible first inventory writes itself from the operator's own sentence: video cutting
& pacing, storytelling / narrative structure, camera language (framing, movement, lens),
lighting & color, sound design, image-prompt composition, voice & character direction,
platform-format constraints (aspect, duration, hooks), review & iteration loops. Each of
those is a Golden Path with 4–6 Techniques and per-tool Applications. **The forge works
unchanged.** Only the brief's evidence pointers change (assets, renders, prompt/result
pairs, performance data) — and gravitone's ingest pipeline (Scribe → speaker → Isolator →
emotion label → clone) is itself a first Application-layer document waiting to be written.

### 2b. Persona / companion memory is RUNTIME knowledge

Personas' memory systems as implemented (scouted, file:line in §9): persona memories
(SQLite, flat, `tier × category`, decay-scored, 6000-char greedy pack — `memory_recall.rs`),
the companion brain (markdown-first with a recoverable SQL mirror, tiers episodic →
semantic → procedural → identity → doctrine, provenance mandatory — `companion/brain/`),
team memories, the workspace knowledge library (deepest taxonomy: closed 15-area
precedence list → open cluster → open facet, `kind`/`status`/`abstraction`/`durability`
axes, 6 typed edges, playbooks — `workspace_taxonomy.rs`), skills (files, Claude Code
convention + sidecar), and projection (derived tiered bundle into `.claude/patterns/`).

Their hierarchies "are nowhere near the golden-path structure" **because they are not
supposed to be**. They are budgeted, decaying, per-agent, evidence-of-experience stores.
Their organizing axes are *retention physics* (tier, half-life, access) and *scope*
(persona/team/user/project/world), not *subject*. Forcing them into subject folders would
destroy exactly the properties (decay, provenance, budgeted recall) that the agent-memory
golden path forged this week names as the standard.

**Where the two meet — and this is the load-bearing design point** — is the
**consolidation door**. The companion's sleep cycle already distills episodes into facts
and procedurals; the workspace harvest already distills scans into `observed` practices
through one governed ingest door; team reflection already synthesizes shared memory. Every
one of those is a *runtime → reference* promotion. **The reference tier is where a
golden-path-shaped KB belongs; the runtime tier feeds it and reads from it, it does not
become it.** For a coding persona this means: its episodic memory stays its own; what it
*learns that generalizes* is proposed (never auto-adopted) into the reference KB, where the
expert-review layer we built decides whether it becomes a Technique, an Application, a
deviation, or noise.

So the answer to "some domains can even be coding where their involvement with the golden
path system could make sense" is: **yes, through the door, not through the tree.** A
coding persona should *consult* the projected bundle (already shipped: `.claude/patterns/`
router → playbook briefs, `/dev-tools/patterns/consult`) and *propose* upward through the
harvest door — both mechanisms exist today.

## 3. Research lead A — OpenWiki and the Open Knowledge Format

**What OpenWiki is:** LangChain's CLI (v0.2, 2026-07-16) that reads a codebase or personal
sources (git, mail, notes, web, HN, X, Slack) and writes/maintains a markdown wiki for
coding agents; discovery is a `<!-- OPENWIKI:START/END -->` pointer block in `AGENTS.md`
/ `CLAUDE.md`; agents "read a curated wiki first, then inspect source only where they need
more." Update via CI (`--update`), a `.last-update.json`, an operator-authored
`INSTRUCTIONS.md` that generation never rewrites.

**What is actually reusable is not OpenWiki — it is the format it emits.** The **Open
Knowledge Format (OKF)** is a vendor-neutral spec (Google Cloud, v0.1 2026-06-12, v0.2
since): *"a folder of markdown concept files, each with a little YAML frontmatter."*
Bundle = directory; `index.md` (bundle metadata: `okf_version`, `okf_bundle_name`,
`okf_bundle_title`, `okf_bundle_entry_*`), `log.md` (audit trail), every other `.md` a
Concept Document whose **only required field is `type`** (a short string — "Service",
"Metric", "Runbook"; **no prescribed vocabulary**); optional `title`, `description`,
`tags`, `use_when` (agent trigger). v0.2 added the trust tier we would have had to invent:
**`generated` (by whom/what, when), `verified` (a list of review records with `by`/`at`),
`sources` (provenance for the body's claims), `status` (draft/stable/deprecated)**.
Design goals, verbatim: *"producer and consumer independence — a bundle hand-written by a
person can be read by an AI agent"*; *"anyone who can open a file can read it and anyone
who can clone a git repo can ship it"*; roles: *"Enrichment agents write into a bundle …
Consumption agents read and traverse it. Because the contract between them is just files,
neither has to know anything about the other."*

**Design patterns to leverage (four), and what to refuse (four):**

Leverage:
1. **`type` as the layer discriminator.** Our four layers become `type: golden-path |
   technique | application | evidence` — legal OKF, and exactly the frontmatter our checker
   already reads (`layer:`). One rename makes every path bundle an OKF bundle.
2. **`generated` / `verified` / `sources` / `status` as the forge's provenance.** Phase 1
   = `generated.by: producer/personas-forge@v2`; Phase 2 reconciliation = a `verified`
   record; evidence pointers = `sources`; `status` maps onto our `draft → forged →
   reconciled → transplant-tested` (OKF's `draft/stable/deprecated` is coarser; keep ours
   in an extension field, emit theirs for interop).
3. **`use_when` as the consult trigger.** This is what our playbook `triggers` and the
   router's "name the situation → match a playbook" already are. Adopting the field name
   costs nothing and makes bundles readable by any OKF consumer.
4. **The pointer-block discovery convention.** We already do it (`@.claude/patterns/README.md`
   in CLAUDE.md, owned-block posture). Aligning on a marker-delimited block is free.

Refuse (or supply ourselves):
1. **OKF has no vocabulary, no hierarchy, no bundle-to-bundle linking, no registry.** All
   four sources agree: no cross-bundle composition, no discovery layer, no type registry.
   Our four layers, owned-technique rule, cross-links, and `_laws.md` anchors are *above*
   OKF, not replaced by it. Good — that is exactly what we know how to build.
2. **OKF is lenient by design (broken links and unknown types tolerated).** Our checker is
   strict by design (unresolved link = fail). Keep ours; emit OKF-valid output.
3. **No staleness enforcement** ("skip OKF when freshness guarantees matter"). Our
   integrity checker + census + deviation register are that enforcement.
4. **OpenWiki's own OKF implementation rejects unknown extension fields** (contrary to the
   draft). Any bundle we emit must therefore keep app-specific fields under one namespaced
   key so a strict consumer can drop them whole. Also noted by reviewers: an agent-updated
   KB is an indirect-prompt-injection surface — our prompt-safety golden path already owns
   that.

Also worth stating plainly: OpenWiki is a *code-first* tool that has one page shape
("concept") and no notion of principle-vs-application. Karpathy-lineage LLM wikis are
flat. **The layered hierarchy is our differentiator; the OKF envelope is the interop we
were missing.** Adopt the envelope, keep the skeleton.

## 4. Research lead B — third-party knowledge registries (ascent's design)

**What ascent shipped:** Skills and Memory as mature org-scoped tabs on its own Postgres
(`OrgSkill*`, `OrgMemory`), a `SKILL.md` frontmatter contract that is a deliberate
near-subset of the Claude Code convention (`name` + `description` required; closed
`category`, `tags`; `version`/`contentHash` out-of-band), a zero-dep sync CLI with a
three-hash drift model (`in_sync | stale | diverged | local_only`), a stateless MCP read
door with layered scopes (`mcp:read` does not imply `memory:read`), a recall function
`confidence × 0.5^(age/half_life(kind)) × (1+0.25·ln(1+access))` greedy-packed into a
character budget returning winners AND losers, and a per-repo `.ai/` standard whose memory
format is one-fact-per-file `NNNN-slug.md` with `kind/scope/date/supersedes/refs`.

**What ascent designed but has NOT built (R1 of 9 slices — every action is a
`console.info` stub, no `OrgRegistry` table, no indexer, no `catalog.json` writer):** the
customer-owned git registry `<org>/ai-registry/` with `.ascent/registry.yaml`,
`catalog.json` (generated index), `skills/<name>/{SKILL.md,LESSONS.md}`,
`practices/<slug>/PRACTICE.md`, `memory/<kind>/<slug>.md`, `memory/_index.md`,
`telemetry/<repo>/<yyyy-mm>.jsonl`, `CODEOWNERS`. The ADR-grade rationale
(`GOLDEN-USE-CASES.md:50-52`): *"the SaaS's own database must not be the only place a
customer's skills and knowledge live (lock-in, no offline path, no git history, no review
flow)"*; *"Git is the door for content; the API is the door for counts"*; *"Agents propose,
humans adopt"* (merge = adopt via CODEOWNERS); ascent *"opens pull requests, it does not
push"*; two modes kept forever (git-native default, hosted).

**Assessment against the operator's question — should we consider it?** Yes, and three
facts make it more than a nice-to-have:

1. **Personas already IS this for its two most portable systems.** The companion brain's
   authority is markdown on disk with a declared-recoverable SQL index; skills live in
   `.claude/skills/` with a provenance sidecar; projection writes an owned bundle into
   target repos with a "never rewrite the user's prose" posture. The scout's through-line:
   *authority migrates outward as the consumer gets further from the app.* A registry is
   the terminal point of that migration, not a new idea.
2. **Ascent's registry design and OKF are the same shape.** `catalog.json` ≈ `index.md`
   metadata; `memory/<kind>/<slug>.md` with `kind/confidence/namespace/supersedes/source`
   ≈ OKF concept + `sources`/`status`; `LESSONS.md` ≈ `log.md`. Neither knew about the
   other; convergence of independent designs is the oracle the campaign trusts most.
3. **The two apps' vocabularies are ALREADY drifting.** ascent org-memory kinds
   `episodic|semantic|procedural|summary` vs its own `.ai/memory` kinds
   `decision|gotcha|failed-approach|convention|reference`; Personas persona-memory
   categories `fact|preference|instruction|context|learned|constraint` vs companion facts
   `user|project|world` vs workspace kinds `pattern|pitfall|decision|howto|fact`. Five
   closed vocabularies for "a kind of remembered thing" across two repos by one operator.
   **This is one-authority-per-vocabulary violated at portfolio scale**, and a shared
   format is the only fix that doesn't require every app to agree on internals.

**But: it must not stop where ascent's design stops.** Ascent's registry holds *skills,
practices, memory* — three flat item kinds. It has no principle layer, no technique
ownership, no evidence discipline, no deviation register. Transplanting ascent's registry
as-is would re-create the v1 flatness one level up. The registry we want carries the
four-layer bundle.

## 5. The proposal — one format, two tiers, one door

### 5.1 The Reference Knowledge Bundle (RKB) — an OKF profile

A **profile** of OKF, not a fork: every RKB is a valid OKF bundle; extra structure lives in
one namespaced extension key so strict consumers can drop it whole.

```
<bundle>/
├── index.md                 # OKF bundle metadata + our extension block
├── log.md                   # forge/verify/deviation audit trail (OKF reserved)
├── _laws.md                 # optional: cross-cutting laws this bundle cites (anchors)
├── <subject>/
│   ├── <subject>.md         # type: golden-path
│   ├── techniques/<t>.md    # type: technique
│   ├── applications/<stack>--<t>.md   # type: application
│   └── evidence.md          # type: evidence — sparse pointers (optional; may live in frontmatter)
└── deviations.md            # registered gaps (standard kept), one anchor per subject
```

Frontmatter (concept document, illustrative):

```yaml
---
type: technique                # OKF-required; our layer discriminator
title: Cut on action
description: When and how to place the cut inside a movement so the eye never sees it.
use_when: [editing dialogue, action coverage, matching two takes]
status: stable                 # OKF; ours below
generated: {by: "producer:personas-forge/2.0", at: 2026-08-18T10:00:00Z}
verified: [{by: "human:kazdan", at: 2026-08-18T12:00:00Z}]
sources: ["evidence:cut-pacing/clip-004", "doctrine:...#anchor"]
x-rkb:                         # ONE namespaced extension key — droppable whole
  layer: technique
  subject: cut-and-pacing
  technique: cut-on-action
  status: forged               # draft|forged|reconciled|transplant-tested
  laws: [identity-survives-reuse]
  shared_with: []
  domain: media-craft          # the domain the purity denylist is authored for
---
```

Rules carried over from `GRAPH.md` unchanged: one owner per technique, `@owner`
references, bidirectional links, evidence sparse, deviations registered, purity of the
two upper layers — with the purity **denylist authored per domain** (`domain:` above picks
it). The integrity checker gains a domain switch and an OKF-validity pass; nothing else
changes.

### 5.2 Two tiers, one door

- **Reference tier** = RKB bundles. Slow, reviewed, shared. Golden-path forge produces
  them (any domain). Consumers: humans, coding agents via projection, personas via
  consult, other apps via the format.
- **Runtime tier** = each app's memory system, unchanged. Persona memories, companion
  brain, team memory, ascent OrgMemory. Fast, decaying, budgeted, per-agent, bespoke by
  right.
- **The door** = promotion from runtime to reference is a *proposal* through one governed
  ingest (Personas: `ingest_candidates` and the sleep-cycle proposal lane; ascent: PR into
  the registry — "agents propose, humans adopt"). Nothing auto-adopts into reference.
  Demotion (reference → runtime) is *consult*: recall pulls the relevant slice into the
  prompt under a budget (agent-memory's recall-injection technique; ascent's packed
  recall).

The one vocabulary that must be shared across the door is small: **`kind` of a proposed
item** (`observation | pattern | pitfall | decision | howto | fact`) and **`status`**
(`observed → proposed → adopted → deprecated → rejected`). Personas already has both as
DB CHECKs (`dev_workspaces.rs`); ascent's `.ai/memory` kinds map onto them with an alias
table. That is the concrete one-authority fix for §4 item 3 — not "everyone uses one
memory schema" but "everything that crosses the door speaks one small vocabulary."

### 5.3 The registry = a git repo of RKB bundles

Adopt ascent's shape wholesale where it is settled and settle what it left open:

- One git repo per owner (`<org>/knowledge` or `~/knowledge`), bundles as top-level dirs
  (`software-engineering/`, `media-craft/`, …), `catalog.json` generated (bundle, subject,
  version, contentHash, adopters), `CODEOWNERS` so merge = adopt.
- Apps are **indexers and proposers, never the write path**: they open PRs and mirror rows;
  a person with `git` and an editor is a first-class citizen; drift model
  `in_sync | stale | diverged | local_only` (ascent's three-hash CLI is exactly this and is
  already zero-dep — port it).
- Multiple registries allowed, one canonical, canonical-wins on collision (ascent's rule).
- Personas' `.claude/patterns/` projection becomes *one consumer* of the registry (it
  already renders from `adopted` rows; make those rows a mirror of the bundle instead of the
  authority) — and the ambient-router / on-intent-brief split it learned the hard way
  (v1: 455 practices imported wholesale = tax on every turn) is the consumption doctrine
  every registry consumer should inherit.

This eliminates the dependency the operator named: no running Personas app, no Personas
architecture, needed to *read* the knowledge; both apps standardize on the bundle; and any
future tool that speaks OKF reads it out of the box.

## 6. What this means for gravitone specifically

Run the same campaign shape, sized down: (1) fresh subject scan of the *craft* — from
gravitone's own pipeline, tools, produced assets, and the operator's professional intent —
NOT from the software subject list; (2) operator gates the inventory; (3) forge each
subject two-phase, with the domain purity denylist (no asset ids, no tool product names in
the upper two layers) and evidence = asset + outcome; (4) Applications keyed by *tool* the
way ours are keyed by stack (`<tool>--<technique>.md`); (5) land the bundle in the
registry as `media-craft/`. The forge briefs are the same template with the domain
paragraph swapped. Ten subjects would be a real first bundle; the eight-composer wave
cadence measured this week (~12 min, ~1.4M tokens per 8) applies.

## 7. What NOT to do

- Do not migrate persona/companion memory into the golden-path tree. It is runtime memory;
  the standard for it is the `agent-memory` golden path we forged, and it says decay,
  provenance, budgeted recall — none of which a subject folder gives you.
- Do not adopt OpenWiki the tool as our generator. It has one page shape and no layers; our
  forge is stronger. Adopt the OKF envelope only.
- Do not build a registry that holds flat skills/practices/memory (ascent's R1 shape) — it
  re-flattens. The registry holds four-layer bundles.
- Do not invent a new frontmatter dialect. `type` + `use_when` + `generated/verified/
  sources/status` from OKF; everything else under one `x-rkb` key.

## 8. Next steps (proposed, sized)

1. **RKB profile spec + checker switch** (½ day): write `docs/concepts/rkb-profile.md`
   from §5.1; add the OKF-validity pass and the per-domain purity switch to
   `check-corpus-integrity.mjs`; emit `index.md` for `docs/concepts/paths/` so it IS an
   OKF bundle. Zero content changes.
2. **Vocabulary alias table** (½ day): the door vocabulary from §5.2 with aliases for
   ascent's `.ai/memory` kinds and Personas' persona-memory categories; land it in both
   repos as data.
3. **Registry v0** (1–2 days): a `knowledge` git repo with `software-engineering/` = the
   85-subject bundle (moved or mirrored — decide with the operator; moving breaks the 4,000
   legacy links, mirroring keeps `docs/concepts/paths/` authoritative for now),
   `catalog.json` generator, ascent's sync CLI ported. Personas projection reads from it.
4. **gravitone `media-craft/` pilot** (one wave): subject scan + operator gate + 8
   composers.
5. **ascent registry R2/R3** land against the same repo instead of a private layout — the
   two apps stop diverging by construction.

The live transplant tests for the software bundle stay a separate session, as the operator
directed.

## 9. Sources

- OpenWiki overview / code mode / personal mode — https://docs.langchain.com/oss/openwiki/overview ,
  https://docs.langchain.com/oss/openwiki/code-mode , https://docs.langchain.com/oss/openwiki/personal-mode
- OKF v0.1 spec extract — https://deepwiki.com/openknowledge-sh/openknowledge/1.2-open-knowledge-format-(okf)-specification
- OKF guide incl. v0.2 provenance fields, roles, limitations — https://witscode.com/open-knowledge-format
- OpenWiki's OKF implementation review — https://openknowledgeformat.com/implementations/openwiki
- OKF/LLM-wiki explainer — https://know.2nth.ai/explainers/agents/openwiki
- ascent: `src/lib/org/skill-frontmatter.ts`, `src/lib/memory/recall.ts`, `scripts/ascent-skills.mjs`,
  `src/lib/standard/{spec,memory}.ts`, `src/lib/org/registry-view.ts`, `docs/REGISTRY-AND-CARE-IMPL.md`,
  `docs/GOLDEN-USE-CASES.md`, `docs/features/org-knowledge/{skills,memory}.md`, `docs/features/org-registry/README.md`
- Personas: `src-tauri/core/src/models/memory.rs` (MEMORY CONTRACT), `src-tauri/db/src/memory_recall.rs`,
  `src-tauri/src/companion/brain/{semantic,procedural,retrieval,doctrine,taxonomy}.rs`, `src-tauri/src/companion/disk.rs`,
  `src-tauri/db/src/repos/{dev_workspaces,workspace_taxonomy}.rs`, `src-tauri/src/commands/infrastructure/{skill_files,workspace_harvest}.rs`,
  `src-tauri/engine/src/workspace_projection.rs`, `docs/concepts/knowledge-hierarchy-plan.md`, `docs/concepts/paths/GRAPH.md`
