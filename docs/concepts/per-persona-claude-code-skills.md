# Per-Persona Claude Code Skills — Concept

> **Status:** Proposal. Generalization of in-flight `engine/skills_sidecar/` work.
> **Source:** `/research` run 2026-05-09 ([Claude + CapCut for Editors — Matt Loui](https://www.youtube.com/watch?v=8oIFBQ9BhVU))
> **Related (in flight):** `src-tauri/src/engine/skills_sidecar/DESIGN.md` — per-connector variant, designed by a sibling `/research` run earlier today.
> **Related (catalogs):** `scripts/templates/`, `scripts/connectors/builtin/` — peer filesystem catalogs.

---

## What this is

A mechanism that lets a persona declare a list of **Claude Code skills** (markdown
`SKILL.md` files Claude Code auto-discovers in `.claude/skills/<name>/`) to be
materialized into its per-execution `exec_dir` before each spawn. The skills
teach the spawned `claude` process domain-specific patterns — Remotion
composition, LaTeX writing conventions, brand-voice rules, JSON-schema design,
SQL-optimization heuristics, etc. — without bloating the system prompt.

Lazy-loaded by Claude Code: the agent sees a 1-line description per skill and
only loads the full body when it decides to invoke. That's the affordance the
Matt Loui video demonstrates with Remotion's bundled skill (`running skill
remotion best practices` at `[00:08:14]` in the source) — the difference
between "Claude knows React generally" and "Claude knows Remotion's exact
composition shape, render flags, and gotchas".

---

## Why this is worth doing

### Direct evidence from the source

The video is a creator-tool walkthrough where a non-developer ships
production-grade motion graphics by speaking English to Claude Code. The
load-bearing mechanism is **not** the model — it is Remotion's bundled
`SKILL.md` that turns "make a pull-shaped UI button animation" into the right
React component shape. Without the skill the same prompt would produce
generic React; with the skill it produces correct Remotion.

### Why it generalizes beyond Remotion

Personas already has seven creator-leaning templates
(`feature-video-creator`, `audio-briefing-host`, `youtube-content-pipeline`,
`visual-brand-asset-factory`, `social-media-designer`,
`game-character-animator`, `autonomous-art-director`). All of them currently
lean on the system prompt to teach Claude the domain — which is why they
ship multi-thousand-token prompts. Domain skills extracted into
`SKILL.md` files would let those templates ship a thinner persona prompt
and let Claude lazy-load the right body when it needs it.

The same mechanism is useful far outside creator content: SQL-tuning skills
for database personas, regulatory-disclosure boilerplate for finance
personas, ADR-format skills for architecture personas. Anywhere a persona
needs a chunk of "how to do X correctly in this domain" knowledge, a skill
beats a prompt section because it is **lazy** and **reusable across personas**.

---

## Existing infrastructure (host-first findings)

Three pieces of infrastructure are already in place and shape the design space.

### 1. The `skills_sidecar` module (in flight, untracked)

`src-tauri/src/engine/skills_sidecar/` contains a `DESIGN.md` and a partial
`mod.rs`. Designed for the **per-connector** use case: each bound connector
gets a `personas-connector-<slug>/SKILL.md` written into `exec_dir/.claude/
skills/`, and the system prompt's `## Connector Usage Reference` section
shrinks to a list of skill pointers. Env-gated via
`PERSONAS_SKILLS_SIDECAR=1`.

The body composer (`build_skill_md`) takes a `ResolvedConnectorHint` and
writes overview/examples/gotchas. **The mechanism is general** — it just
needs a second source of `SKILL.md` content beyond connector hints.

### 2. The personas-internal `Skill` DB schema (wired, lightly used)

A `skills` / `skill_components` / `persona_skills` table set exists in
`src-tauri/src/db/migrations/initial.rs:273-305`. Models in
`src-tauri/src/db/models/skill.rs`:

- `Skill { id, name, version, description, category, is_builtin, ... }`
- `SkillComponent { skill_id, component_type: Tool | TriggerTemplate | CredentialSchema, component_data }`
- `PersonaSkill { persona_id, skill_id, enabled, config }`

Tauri commands at `src-tauri/src/commands/design/skills.rs` expose
`create_skill`, `get_skill`, `list_skills`, `update_skill`,
`add_skill_component`, etc. Frontend bindings at
`src/lib/bindings/PersonaSkill.ts` and `src/api/skills/skills.ts`.

This is **personas-internal "composable agent skills"** — bundles of tools,
triggers, and credentials. Naming collision with the Claude Code term is
unfortunate, but the table is the natural home for a fourth component
variant.

### 3. The `exec_dir/.claude/` writer pattern

The runner already runs **three** writers into `exec_dir/.claude/` before
spawn (`src-tauri/src/engine/runner/mod.rs`):

| Writer | What it writes | Env gate |
|---|---|---|
| `hooks_sidecar::install_sidecar` | `.claude/settings.json` (hook commands) | `PERSONAS_HOOKS_SIDECAR=1` |
| `cli_mcp_config::install_mcp_sidecar` | `.claude/settings.json` (mcp registration — merged with hooks) | always on (when MCP needed) |
| `claude_md_projection` | `exec_dir/.claude/persona-memory.md` | tier-based |
| **(new)** `skills_sidecar::install_sidecar` | `.claude/skills/personas-connector-*/SKILL.md` | `PERSONAS_SKILLS_SIDECAR=1` |

A fifth writer for domain skills would be a fully consistent extension of an
established pattern. The 2026-05-08 lesson noted this had crossed a
2-writer threshold; a domain-skills writer would make it five.

---

## Approaches considered

Three shapes, ranked by how much new surface area they add.

### Approach A — Reuse the `Skill` DB table with a new `ClaudeCodeSkill` component variant

Add `ClaudeCodeSkill` to `SkillComponentType`. The `component_data` column
holds the `SKILL.md` body verbatim. At runtime, `skills_sidecar` is extended
to also walk the executing persona's `persona_skills` bindings and, for each
skill row whose components include a `ClaudeCodeSkill`, write
`exec_dir/.claude/skills/personas-skill-<slug>/SKILL.md` with that body.

- **Pros:** zero new schema, leverages the wired-up DB and Tauri command
  surface, slots into the existing `Skill` UI (whatever form it takes —
  `commands/design/skills.rs` is already callable). Domain-skill authoring
  becomes a CRUD operation in personas itself.
- **Cons:** the `Skill` table currently has no shipped UI for end-user
  authoring; that surface needs to exist before users can add skills. Skill
  bodies live in the DB rather than git-tracked filesystem catalogs (unlike
  templates and connectors).
- **Naming:** distinct prefix `personas-skill-` separates these from the
  connector-derived `personas-connector-` skills. Both can coexist in
  `exec_dir/.claude/skills/` with no conflict.

### Approach B — New filesystem catalog at `scripts/skills/<name>/SKILL.md`

Mirror the `scripts/templates/` and `scripts/connectors/builtin/` pattern.
Each skill is a directory at `scripts/skills/<name>/SKILL.md` (plus optional
reference files), git-tracked, seeded into the `skills` DB table at first
launch (parallel to `seed_builtin_connectors`). A persona binds skills via
`persona_skills` rows the same way Approach A does, but the source of
content is the filesystem catalog.

- **Pros:** matches the established catalog pattern (templates and
  connectors both live in `scripts/`), git-tracked source of truth, easy
  community contribution via PRs, no DB-write UI needed initially.
- **Cons:** introduces a fourth catalog (templates + connectors + builtin
  recipes + skills); seeder needs to run idempotently; harder to ship
  user-authored skills without a separate "user skills" path.
- **Naming:** `personas-skill-` prefix as in Approach A.

### Approach C — Hybrid: filesystem catalog + DB binding

Filesystem catalog at `scripts/skills/<name>/SKILL.md` is the source of
truth (Approach B). Seeder writes catalog skills as `is_builtin=true` rows
into the `skills` table on launch. User-authored skills land as
`is_builtin=false` rows directly via the existing
`commands/design/skills.rs` Tauri commands. `persona_skills` bindings work
identically across both. `skills_sidecar` resolves a binding by reading
`component_data` from DB regardless of origin.

- **Pros:** best of both worlds — git-tracked catalog for community-shippable
  skills, DB authoring for user-specific skills, single binding model. Aligns
  with the `connectors` pattern (filesystem JSON seeded into
  `builtin_connectors` rows; user-extensions live as separate DB rows).
- **Cons:** most code (seeder + DB tables + filesystem catalog + UI hooks).
  Risk of catalog/DB drift if seeder gets it wrong.
- **Naming:** `personas-skill-` prefix as in Approach A.

---

## Recommended path

**Approach C (hybrid)** when this concept is taken off the shelf.

The hybrid mirrors how `connectors` already work and keeps the door open for
both ecosystem contributions (filesystem catalog) and user customization
(DB-authored skills). The marginal cost over Approach A is a seeder script;
the marginal cost over Approach B is reusing the already-wired DB schema.

If concept exploration suggests this is bigger than initially scoped,
fall back to **Approach A** as the v1 (DB-only authoring), then add the
filesystem catalog later when a meaningful catalog of skills exists to
ship. v1 → A; v2 (when ≥5 skills exist) → C.

---

## Blockers / sequencing

1. **In-flight `skills_sidecar` per-connector variant must land first.** It
   is the foundation this concept extends. Adding a domain-skill writer
   before the connector-skill writer would invert the natural growth order
   and risk having to rewrite the shared `build_skill_md` shape mid-flight.
2. **No shipped UI for the `Skill` DB table.** The Tauri commands exist but
   no React surface today. Either Approach A or C requires a Skills tab
   somewhere (most natural home: under Settings or under a persona's
   "Capabilities" panel — which doesn't yet exist either).
3. **Catalog policy is unsettled.** What goes in `scripts/skills/`? A
   curated short list (Remotion, LaTeX, …) is small enough to ship as v1.
   But the moment the catalog grows past ~10 skills the question of "who
   maintains them, against what version of the underlying tool" surfaces —
   the same churn that affects connector hints. Worth deciding catalog
   inclusion criteria before opening contributions.
4. **Persona schema knob.** Which persona-level field declares the skills
   to inject? The runtime-knob rule says "no new schema column when a free
   `PersonaParameter` will do" — but `persona_skills` is already a join
   table, so binding via existing rows is the cleaner fit (Approach A/C).
   No new schema column needed.

---

## Reconsideration triggers

Watch for any of these. If any fires, a future `/research` run (or a human
review) should reopen this document.

- **The `engine/skills_sidecar/` per-connector variant ships and proves
  out.** This unblocks the generalization. Specifically: the `mod.rs`
  partial under `src-tauri/src/engine/skills_sidecar/` lands behind
  `PERSONAS_SKILLS_SIDECAR=1`, the prompt section shrinks lockstep, and at
  least one persona is demonstrated to use less prompt + the same or better
  output quality.
- **A creator-leaning template runs into the prompt-size ceiling.** The
  seven creator templates already ship multi-thousand-token system prompts.
  Once one of them hits the cost/latency ceiling, extracting domain
  knowledge into a skill becomes the obvious cure.
- **Three or more candidate domain skills are identified by `/research`
  runs.** A single skill (Remotion, from this run) does not justify a
  catalog. Once Karpathy-style "knowledge wikis", LaTeX, and one more
  domain candidate have been observed in source material, the v2 catalog
  shape becomes worth building.
- **Anthropic ships a public skill catalog.** If Anthropic publishes
  ecosystem skills (similar to the way they ship the SDK), the right move
  may be to consume their catalog directly rather than build a parallel
  one. Watch for `claude.ai/skills` or similar URLs and changelog entries
  about a "skill registry" or "skill marketplace".

---

## Out of scope

- **Skill authoring UI.** A first-class Skills tab in the personas desktop
  app is necessary for Approach A or C v1 but is its own concept doc when
  the time comes. This document is about the runtime mechanism, not the
  authoring surface.
- **Per-skill versioning at runtime.** The `Skill` table already has a
  `version` column; v1 ignores it (latest version always wins). Multi-version
  resolution is a v3 concern at earliest.
- **Skill discovery from npm packages.** The Matt Loui video relies on
  Remotion's npm package shipping its own `.claude/skills/` directory, which
  Claude Code picks up because the persona's `exec_dir` has Remotion
  installed in `node_modules`. That's a Claude Code feature, not a personas
  feature — personas does not need to do anything to enable it. **Note:**
  this means there is a *third* source of skills in `exec_dir/.claude/skills/`
  beyond connector skills and domain skills: skills shipped by npm packages
  the persona's `exec_dir` happens to have installed. They cohabit fine
  because of distinct prefixes.
- **Skill output styles.** Claude Code 2.1 introduced `outputStyles`, a
  related but distinct mechanism. They control format of responses, not
  domain knowledge. Out of scope here.

---

## Cross-references

- `src-tauri/src/engine/skills_sidecar/DESIGN.md` — per-connector variant
  this concept generalizes from. Read first for the runtime mechanism.
- `src-tauri/src/engine/hooks_sidecar.rs` — the canonical
  "personas-writes-into-exec_dir/.claude" pattern. Skills sidecar is a
  sibling.
- `src-tauri/src/db/models/skill.rs` — the existing `Skill` /
  `SkillComponent` / `PersonaSkill` schema this concept extends.
- `src-tauri/src/commands/design/skills.rs` — the Tauri command surface
  already wired for the `Skill` table.
- `src-tauri/src/commands/infrastructure/skill_files.rs` — the read-only
  browser for the active dev project's `.claude/skills/` directory. Used
  by the dev-tools Skills tab. **Distinct from this concept** — that surface
  shows skills authored by a developer in a code project; this concept is
  about skills shipped by personas to spawned `claude` subprocesses.
- `.claude/codebase-stack.md` §2 ("Engine: Claude Code CLI Wrapping") —
  background on how personas spawns `claude` and why writing into
  `exec_dir/.claude/` is the canonical extension point.
