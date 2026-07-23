# Brainiac → Personas: Skills, Memory, Documentation as first-class passport modules

Status: **analysis** (2026-07-22). No code yet — this is the adoption map. Source
analysis: Brainiac checkout at `C:\Users\mkdol\dolla\brainiac` (Rust workspace +
Postgres; LIBRARY-PLAN / KB-PLAN / ARCHITECTURE docs; migrations 0001–0038).
Personas grounding: the passport wall as of `e7640175d` (skills counts + LLM
adopt/share), `probeRepoEvidence` (dev_tools.rs:3369), `persona_memories` +
Memory Engine v2, the findings spine (`dev_ideas` origin/evidence/dedup_key),
`system_op_automation` sweeps, and the fleet transcript layer over
`~/.claude/projects/*.jsonl`.

## 0. The thesis worth stealing

Brainiac's three layers share one design idea, stated in LIBRARY-PLAN.md:11-19:
**the anti-rot mechanism is telemetry, not composition** — "a standard nobody
follows and a skill nobody invokes go visibly red." Every artifact (skill,
memory, page) carries:

1. an **append-only usage/event log** (no UPDATE grant — fetch/check/apply for
   skills, reads with `was_dirty` for docs, feedback claims for memories);
2. an **age-guarded dormancy rule** ("adopted yesterday with no uses is NEW,
   not dead" — brainiac-core/health.rs:53);
3. a **deterministic sweep** that turns signals into *proposals* for a human
   gate (mining sweeps propose, only humans adopt/publish);
4. **rejection as durable knowledge** (rejected candidates block re-proposal
   inside a window, return as fresh dated candidates after it);
5. **warn-only telemetry writes** ("vital signs must never cost an agent its
   answer" — usage insert failures log and continue).

Personas already has the *receiving* half of this loop that Brainiac had to
build from scratch: the findings spine (`dev_ideas` with origin/evidence/
dedup_key, rejected-is-durable), triage rules, the Dev runner as the LLM
executor, `system_op_automation` for scheduled sweeps, and — uniquely — **direct
access to Claude Code session transcripts** (fleet watcher +
`cli_session_awareness` already parse `~/.claude/projects/<encoded-cwd>/*.jsonl`).
Transcripts are the local-first substitute for Brainiac's MCP-side usage
counting: we can *mine* what agents actually invoked and read, per project,
deterministically.

**Explicitly NOT adopting** (multi-tenant machinery with no local analog):
RLS/visibility tiers (private/team/org collapses to single-user), the
contractor/observer principal work, Postgres/pgvector hybrid retrieval for
project knowledge, Confluence/Git/OKF publishing, and the full
compose-pages-from-memories inversion (repo docs are authored artifacts here,
not projections — we adopt the dirty-tracking, reads, and health ideas around
them, not the projection engine). Console UI explicitly out of scope per task.

---

## 1. SKILLS — from "counts" to a measured library

### Brainiac mechanics (source of truth)

| Mechanic | Where |
|---|---|
| `skills` (slug, maturity draft→published→deprecated, current_version, proposed_by) + immutable `skill_versions` (semver, manifest, content, `published_by NULL = draft, never served`) | 0028_library_substrate.sql:110-144 |
| `library_usage_events` — append-only; `event ∈ fetch/check/apply`; team column, **no user column** (never a leaderboard); INSERT+SELECT grant only | 0028:149-163,206 |
| Usage recorded at serve time (fetch on download, one fetch per rule served) + agent-reported check/apply; **fetch refused on the self-report path** so agents can't inflate it | mcp.rs:1966-2028 |
| Dormancy: `LIBRARY_DORMANT_DAYS=30`, dormant = older than window AND zero uses; gate SLA (`oldest_gate_secs` vs 14d SLO) | health.rs:42-54, usage.rs:62-100 |
| Mining sweep: 3 deterministic miners (unclaimed divergences; memories with ≥2 independent "helpful" feedbacks; resolved-supersede contradiction winners), weekly, seeded disabled; rejection-aware dedup window (90d) | library_sweep.rs, 0029 |
| Proposal guardrails: per-author rate limit (5/h), dedup by slug or verbatim statement against ALL lifecycles ("the org already decided"), evidence validated | proposals.rs:29-140 |

### Personas today

Filesystem-only: `.claude/skills` per project + `~/.claude/skills` global;
`SkillEntry.syncState` (in_sync/diverged/local_only via provenance sidecar +
content hash); passport cell = shared-by-name vs codebase-specific counts;
LLM-backed adopt (customize-to-repo) / share (generalize-to-library) via Dev
runner (`e7640175d`). **No usage data, no version history, no lifecycle, no
mining, no health.**

### Adoption — data design

Keep the filesystem as the artifact store (Claude Code serves skills from
disk; that IS the distribution layer). Add a SQLite index + telemetry beside it:

```sql
-- Reconciled by scan (idempotent, like the passport scan). The filesystem
-- stays authoritative for content; this table is identity + telemetry anchor.
CREATE TABLE skill_registry (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  scope         TEXT NOT NULL CHECK (scope IN ('global','project')),
  project_id    TEXT REFERENCES dev_projects(id) ON DELETE CASCADE, -- NULL when global
  content_hash  TEXT NOT NULL,
  description   TEXT,
  origin        TEXT NOT NULL DEFAULT 'authored'
                CHECK (origin IN ('authored','adopted','shared','generated')),
  first_seen_at TEXT NOT NULL,
  last_changed_at TEXT NOT NULL,
  UNIQUE (name, scope, project_id)
);

-- Brainiac's standard_versions, localized: hash-per-revision history so
-- divergence-from-library becomes measurable over time (today syncState is
-- only a point-in-time tri-state).
CREATE TABLE skill_revisions (
  skill_id     TEXT NOT NULL REFERENCES skill_registry(id) ON DELETE CASCADE,
  rev          INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  changed_by   TEXT NOT NULL CHECK (changed_by IN ('user','llm_task','adopt','share')),
  changed_at   TEXT NOT NULL,
  PRIMARY KEY (skill_id, rev)
);

-- Append-only. Repos expose insert + select only (SQLite can't revoke UPDATE;
-- enforce at the repo layer, same posture as Brainiac's grants).
CREATE TABLE skill_usage_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name  TEXT NOT NULL,
  project_id  TEXT,                -- attributed via transcript project dir
  session_id  TEXT,                -- CC session uuid; dedup anchor
  event       TEXT NOT NULL CHECK (event IN ('invoke','fetch')),
  source      TEXT NOT NULL CHECK (source IN ('transcript','dev_runner')),
  occurred_at TEXT NOT NULL
);
CREATE INDEX idx_sue_skill ON skill_usage_events(skill_name, project_id, occurred_at);
CREATE UNIQUE INDEX idx_sue_dedup ON skill_usage_events(session_id, skill_name, occurred_at);
```

### Adoption — feature design

1. **Usage counting via transcript mining** (the user's named example). A
   deterministic sweep walks `~/.claude/projects/<proj>/*.jsonl` incrementally
   (byte-offset watermark per file, same pattern as fleet transcript reading)
   and extracts skill invocations: `Skill` tool_use blocks and
   `<command-name>` markers. Attribution: project dir name → `dev_projects`
   root_path (needs the trivial cwd→encoded-dir helper; fleet already watches
   these dirs but never parses for skills). Dedup by (session, skill,
   timestamp). Dev-runner tasks that invoke skills record `source='dev_runner'`
   directly. **Warn-only writes** — mining must never break a scan.
2. **Dormancy health, age-guarded**: `dormant = first_seen_at < now-30d AND
   zero invokes in window`, computed per project and for the global library.
   Surfaces as (a) a third signal in the passport skills cell — `4 shared · 1
   specific · 2 dormant`; (b) a **finding** (`origin=skill_dormant`,
   `dedup_key=skill:<scope>:<name>`) into the existing triage loop — Brainiac's
   "attention item" maps 1:1 onto the findings spine, and rejected findings
   already give us the rejection-aware dedup window for free.
3. **Adoption metric done honestly**: locally there is no "fetch denominator"
   (Claude Code loads skills silently), so the passport reports *invocations*
   and *never-invoked-since-adoption* — not fake fetch counts. `fetch` events
   exist only for our own adopt/share/serve paths.
4. **Proposal guardrails ported to the SkillsModal**: dedup a share/adopt
   proposal against the registry by name AND content hash across *all*
   origins — "your library already decided" beats re-generalizing the same
   skill twice; the mining sweep (below) respects rejected findings for 90d.
5. **Skill mining (later phase)**: deterministic candidates for "this should
   become a shared skill" — a project-specific skill invoked in ≥2 projects'
   transcripts under the same name, or a skill whose per-project copies have
   converged hashes. Proposes a share task; never auto-shares (human gate =
   the existing modal, matching Brainiac's humans-publish invariant).

### Passport cell

`counts` cell grows: `shared / specific / dormant`, and the SkillsModal gains a
usage column (last invoked, 30d count) per skill — data the modal already has a
natural home for. Dimension scoring: skills contribution upgrades from the flat
`hasSkills ? 8 : 0` in passportDerive.ts:122 to reward *used* skills (e.g. 4 for
present + up to 4 scaled by non-dormant share).

---

## 2. MEMORY — a real dimension instead of `memory: false`

### Brainiac mechanics

| Mechanic | Where |
|---|---|
| Status ladder raw→candidate→canonical→deprecated/rejected; every transition audited in `promotions` (policy_rule recorded) | 0001_init.sql:65,168-179 |
| Kind vocabulary fact/decision/pattern/pitfall/howto with **per-kind TTLs** (365/540/540/365/180d), `valid_from/valid_to`, `superseded_by` | types.rs:114-123 |
| **Raw-TTL sweep**: unreviewed raw memories past TTL → `rejected` with audit row — "declined by neglect" beats serving unreviewed beliefs with implied authority | memories.rs:79-133, 0024 |
| Feedback claims: helpful/wrong/outdated; negative claims STAY OPEN until a maintainer resolves (reverified/deprecated/dismissed + note); triage queue ranks by dispute count; trust = bounded tanh nudge on ranking, never a gate | 0004/0005/0026, feedback.rs |
| Contradiction detection: LLM verdict on entity-anchored neighbors, **advisory only** — application is human-only | contradict.rs:43-49 |
| Health pillars: consistency/currency/governance/liquidity 0-100, weighted composite **capped** by cross-team contradictions; snapshots table for trends | health.rs:59-119, 0014 |
| Practice divergences: same problem solved differently across teams/projects, detected in aggregate, ratifiable into a standard | 0016/0037, divergence.rs |

### Personas today

Two disjoint things: (a) the **passport row is hardcoded dead** —
`memory: false` in passportDerive.ts:225; (b) the **persona/team memory engine**
is real and already Brainiac-adjacent: `persona_memories` with
`tier('active'…)`, `access_count`, `last_accessed_at` (decay recall),
`derived_from` (synthesis provenance), category, importance, reflection loops,
proposal-gated writes, review proposals. What it lacks vs Brainiac: temporal
validity/TTL, feedback claims with open-until-resolved semantics,
contradiction advisory, and a health rollup.

### Adoption — two layers

**Layer 1: make the passport dimension real (pure probe, no schema).** Extend
`probeRepoEvidence` (or a sibling probe) to detect repo-level agent memory:

- `~/.claude/projects/<encoded-root>/memory/MEMORY.md` — Claude Code
  auto-memory for that repo (index lines count + newest entry mtime);
- in-repo `MEMORY.md` / `.claude/memory/**` / a `# Memory` section in CLAUDE.md;
- Personas-managed governance (layer 2 below) once it exists.

Ordinal scale (GRAPH_SCALE pattern): `none → adhoc` (some memory artifact
exists) `→ curated` (an index + ≥N entries, updated in last 30d) `→ governed`
(review/decay loop active). Replaces the dead boolean; scoring gives memory the
weight the hardcoded false silently withheld.

**Layer 2: upgrade the existing memory engine with Brainiac's honesty
mechanics** (applies to persona/team memories, which are the app's real memory
substrate):

```sql
ALTER TABLE persona_memories ADD COLUMN valid_to TEXT;          -- per-category TTL stamp
ALTER TABLE persona_memories ADD COLUMN superseded_by TEXT;     -- forward pointer

CREATE TABLE memory_claims (                                    -- Brainiac memory_feedback
  id          TEXT PRIMARY KEY,
  memory_id   TEXT NOT NULL REFERENCES persona_memories(id) ON DELETE CASCADE,
  verdict     TEXT NOT NULL CHECK (verdict IN ('helpful','wrong','outdated')),
  note        TEXT,
  source      TEXT NOT NULL,      -- execution id / reflection pass / user
  created_at  TEXT NOT NULL,
  resolution  TEXT CHECK (resolution IN ('reverified','deprecated','dismissed')),
  resolution_note TEXT,           -- maintainer rationale, separate from reporter note
  resolved_at TEXT
);

CREATE TABLE knowledge_health_snapshots (                       -- per project/team trend
  id          TEXT PRIMARY KEY,
  scope_kind  TEXT NOT NULL CHECK (scope_kind IN ('project','team','persona')),
  scope_id    TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  score       INTEGER NOT NULL,
  currency    INTEGER, consistency INTEGER, governance INTEGER,
  stale_count INTEGER, total_count INTEGER, open_claims INTEGER
);
```

Feature mechanics to port, in Personas idiom:

1. **Per-category TTL + "declined by neglect"**: stamp `valid_to` from category
   defaults at write; a sweep (system_op, seeded OFF like everything here)
   archives *proposal-originated, never-reviewed* memories past TTL with an
   audit trail — mirrors raw-TTL exactly and composes with the existing
   forgetting pass.
2. **Claims loop**: executions/reflection file `wrong|outdated` claims when a
   recalled memory conflicts with observed reality; open negative claims (a)
   apply a bounded tanh nudge to recall ranking (Personas has
   importance+recency; this is the third, deliberately tiebreak-scale term)
   and (b) surface as findings (`origin=memory_disputed`) → the human resolves
   reverify/deprecate/dismiss. Resolution honors the proposal-gated doctrine —
   nothing auto-deprecates.
3. **Contradiction advisory on write**: nearest-neighbor check within the
   persona/team scope (embedding meta already exists), LLM verdict, output is
   a *proposal*, never an applied supersession — identical posture to the
   reflection engine's existing proposals.
4. **Health snapshot sweep**: currency (share not past `valid_to` and not
   deprecated), consistency (open contradiction/claim count), governance
   (proposal backlog age vs an SLO). Composite capped by open cross-persona
   contradictions (the "one bad signal caps the grade" idea). Snapshot feeds
   the passport memory row's sub-label and the cover trend.

---

## 3. DOCUMENTATION — a new dimension with a rot loop

### Brainiac mechanics

| Mechanic | Where |
|---|---|
| `dirty_at` on documents + `document_dependencies` inverted index; every governance mutation calls `mark_dirty_for_memory` — "the single call separating a wiki with a review queue from a wiki that cannot rot" | 0017, governance.rs:195-384 |
| `document_reads` append-only: channel (http/mcp), **`was_dirty` at read time** — rot *being consumed* ranks harm; `pages_never_read` | 0025, docs.rs:35-58 |
| Reads recorded post-commit, warn-only, only when content actually served | documents.rs:504-522 |
| Faithfulness: sampled (≤8 paragraphs), judged claim-vs-cited-source, **advisory only, never gates**, stored JSONB on the revision | 0036, faithfulness.rs |
| Compose backoff (poison pages), publish circuit-breaker on health floors ("silence beats confident staleness") | 0021, health.rs:145-159 |

### Personas today

No documentation dimension. `RepoEvidence` knows `has_readme`, `has_claude_md`,
`has_security_md`. Personas' own repo practices the discipline (feature-doc-map
+ Stop hook) but nothing measures it in scanned projects.

### Adoption — feature design (deterministic first)

Repo docs are authored files, not projections — so we do NOT port the compose
engine. We port the *measurement*:

1. **Docs probe** (RepoEvidence extension, cheap): docs file census (`docs/**`,
   `*.md` at root, README size), presence of a doc-map manifest
   (`scripts/docs/feature-doc-map.json` or equivalent), presence of a doc-sync
   hook. Ordinal: `none → readme → structured → synced`.
2. **Doc-rot scan — the local `dirty_at`**: deterministic git signal, no LLM.
   For each doc, derive its coupled source scope (explicit doc-map when
   present; else heuristic: paths referenced in the doc + top-level dir
   affinity) and compare `git log -1 <doc>` vs commits touching the coupled
   scope since. `dirty_docs` count + worst offenders. Runs as a scan in the
   Factory (same Dev-runner/scan chassis as context scans).

```sql
CREATE TABLE doc_status (
  project_id   TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  doc_path     TEXT NOT NULL,
  coupled_scope TEXT,             -- JSON array of source globs (doc-map or heuristic)
  last_doc_commit TEXT, last_source_commit TEXT,
  dirty_since  TEXT,              -- NULL = clean; the local dirty_at
  scanned_at   TEXT NOT NULL,
  PRIMARY KEY (project_id, doc_path)
);

CREATE TABLE doc_read_events (    -- mined from transcripts, append-only
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL,
  doc_path    TEXT NOT NULL,
  session_id  TEXT,
  was_dirty   INTEGER NOT NULL DEFAULT 0,   -- dirty per doc_status at read time
  read_at     TEXT NOT NULL
);
```

3. **Dirty docs → findings → Dev-runner refresh**: each dirty doc emits a
   finding (`origin=doc_rot`, `dedup_key=doc:<project>:<path>`, evidence = the
   source commits since the doc's last touch). Accepting it queues a
   Dev-runner task whose prompt carries the diff scope ("update THIS doc for
   THESE changes; do not invent") — the whole
   findings→triage→task→PR pipeline is reused unchanged. This is Brainiac's
   dirty→recompose loop with "recompose" replaced by an evidence-carrying LLM
   task, which fits authored docs.
4. **Reads mining** (same transcript sweep as skills): `Read` tool calls into
   doc paths → `doc_read_events`, joined against `doc_status.dirty_since` at
   read time. Two derived signals, straight from Brainiac: **dirty-doc reads**
   (agents consuming stale docs — ranks which rot actually hurts) and
   **docs-never-read** (dead weight / silo candidates). Both feed the passport
   sub-label and findings priority.
5. **Faithfulness (later, advisory)**: sampled claim-vs-code check via a
   Dev-runner task on review-bound docs only; informs, never gates.

### Passport row

New row in "Readiness for full automation" (docs are agent grounding — sits
beside Agent instructions): `Documentation`, ordinal
`none → readme → structured → fresh → synced` where `fresh` requires a rot scan
with zero/low dirty docs and `synced` requires a doc-map + enforcement. Cell
sub-label: `3 dirty · 2 never read`.

---

## 4. Cross-cutting adoptions

- **One health rollup per project**: `knowledge_health_snapshots(scope='project')`
  aggregates the three modules (skills dormancy, memory health, doc rot) —
  trend-lineable, and the passport cover's Trend already renders deltas.
  Follow Brainiac's restraint: new signals become *attention items/findings*,
  not new weighted pillars, until they earn calibration ("going red IS the
  promise, it needs no weight in a composite").
- **All sweeps ride `system_op_automation`**, seeded **disabled** (Brainiac
  seeds every sweep disabled — matches Personas' default-OFF autonomy posture).
  One new op kind `knowledge_health` runs: transcript mining → skill dormancy →
  doc rot → memory health snapshot, per registered project, warn-only writes
  throughout.
- **Findings spine is the universal outlet**: `skill_dormant`,
  `memory_disputed`, `doc_rot` origins with stable dedup_keys; rejected
  findings ARE the rejection-window dedup (already durable in `dev_ideas`).
- **Append-only telemetry discipline**: repos expose insert+select only for
  event tables; no update paths.
- **Age guards on every dormancy/staleness rule** so new artifacts never read
  as dead.

## 5. Phasing

| Phase | Scope | Schema? | LLM? |
|---|---|---|---|
| **P0 — SHIPPED `89ae3faf5` (2026-07-22)** | Memory probe + docs probe → both passport rows live (memory ordinal replaces hardcoded false; new Documentation row); RepoEvidence extension; derive/scoring update; golden-rubric dims + ladders + provenance + two Dev-runner setup tasks | none | none |
| **P1 — SHIPPED `9fed7a945`+`643119a79` (2026-07-23)** | `skill_registry` (+revisions, missing_since, fs-true first_seen) + append-only `skill_usage_events` + incremental transcript mining (`skill_usage_scan`/`skill_usage_overview`); skills cell dormant tally; `skill_dormant` findings (E6); SkillsModal usage lines + hash-based share dedup. Live: 59 skills tracked, 40 dormant, real invoke attribution | yes | none |
| **P2 — SHIPPED `bb2f11d20`+`b4a6faaa2` (2026-07-23)** | `doc_status` (git dirty_since, doc-map/referenced-path coupling, unscoped-is-not-rot) + `doc_read_events` mined in the shared transcript pass (was_dirty stamped at insert) + harm-ranked `doc_rot` findings (E7) with evidence-carrying refresh prompts + "Refresh stale docs" cell task + `N dirty · M unread` sub-line. DEVIATIONS: no `fresh` ladder rung (volatile health as sub-label + findings, not a maturity rung); file references couple per-file after the 78%-dirty first scan. KNOWN BIAS: reads count Read-tool usage only — Grep/Bash doc access is invisible (possible P4 refinement). Live: 1723 docs tracked / 11 repos, ~1.3k dirty (honest for hourly-shipping repos), read-while-stale stamping proven | yes | task-level only |
| **P3 — SHIPPED `9c5c57ebd` (2026-07-23)** | `memory_claims` open-until-resolved loop + `open_claim_count` recall penalty (−35% tanh cap, forgetting inherits it) + `memory_disputed` findings (E9, human-resolution routed) + Disputes UI in the memory detail modal (18 keys × 13 locales) + `knowledge_health_snapshots` (currency by the recall half-life table / consistency / governance vs 7d SLO, dispute-capped composite) + `governed` rung live on the wall (`health N · M disputed` sub-line). DEVIATIONS: no `valid_to`/`superseded_by` — half-life decay + working-tier 30d expiry + ACTIVE_CAP already ARE the TTL/neglect mechanism (found during grounding: `run_lifecycle` archives untouched working rows; the plan's neglect sweep pre-existed). Live: claims loop proven on real data (file→1→overview→resolve→0), 7 team projects snapshotted (98/100/96 scores), wall shows Governed | yes | none |
| **P4** | Advisory extras: contradiction-on-write proposals, doc faithfulness sampling, skill share-mining candidates | no new tables | yes, advisory |

Each phase lands independently; P0 is a same-day change and immediately makes
two dead/absent dimensions honest. P1 delivers the named ask (skill usage
counting). P2–P3 close the loop where signals become dispatched work.
