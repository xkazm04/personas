# The Skill Standard — versioning, dual reflection, offline sync

Status: shipped 2026-08-07 (worktree-skill-standard-trace).
Companion surfaces: Dev Tools → Skills → Trace tab; the adopt/share LLM lanes
(`skillTasks.ts`); `dispatchSkillToRepo` (`skillPlacement.ts`); the
`skill_registry`/`skill_revisions` telemetry (`skill_usage.rs`).

Skills are directories (`.claude/skills/<name>/SKILL.md` + reference files)
that travel between the workspace library (`~/.claude/skills`) and project
repos. Before this standard they had adoption, sharing and usage counting but
no reflection ritual, no version vocabulary, and no way for an offline session
to know who else runs the same skill. This document is the canonical statement
of the four mechanisms that close those gaps.

## 1. `version:` frontmatter (major.minor)

```yaml
---
name: scan-sweep
description: "…"
version: 1.2
---
```

- **minor bump** (1.2 → 1.3): a prompt/step refinement from a reflection.
- **major bump** (1.x → 2.0): a methodic redesign.
- **absent**: the skill predates the standard. Consumers treat it as an
  implicit `1.0`; nothing mass-stamps old skills (lazy stamping: the adopt/
  share passes and the first real bump write `version: 1.0`/`1.1` on touch).
- Malformed values normalize to unversioned (`skill_files.rs::extract_skill_version`).
- The declared version is stamped into `skill_registry.version` and onto each
  `skill_revisions` row at reconcile, so the revision history doubles as a
  version timeline (`skill_version_timeline` command).
- A version bump is an edit to SKILL.md, so it always changes the content hash —
  never bump without applying the improvement in the same change, never edit
  the method without a bump.

Rule of thumb for drift verdicts (computed frontend-side from the two list
commands): library newer than installed = **behind**; equal versions with
differing hashes = **customized**; installed newer than library = **ahead —
share it**.

## 2. Dual reflection (the REFLECTION BLOCK)

Every skill run ends with two reflection lanes, executed autonomously by the
LLM (no user gate). The canonical contract text lives in
`src/features/teams/sub_factory/passport/reflectionBlock.ts` and reaches
sessions two ways:

- **Dispatched runs**: `dispatchSkillToRepo` appends the block to every skill
  dispatch (after the MEMORY BLOCK when one exists).
- **Manual terminal runs**: the adopt/share LLM passes standardize a
  `## Skill Reflection` trailer into every SKILL.md copy they write. The
  dispatch block supersedes the trailer for the run it rides on.

The two lanes:

1. **Project learnings** → the memory outbox (`.personas/memory-outbox.jsonl`)
   per the MEMORY BLOCK contract — the existing ledger pipeline.
2. **Method learnings** → `LESSONS.md` in the skill directory, plus a version
   bump when (and only when) the improvement is applied to SKILL.md.

Honesty calibration is the load-bearing rule: *most runs produce nothing for
lane 2*. An empty reflection is a valid result; a forced lesson is pollution.
Expected distribution: nothing (common) / one line (sometimes) / a lesson
entry (occasionally) / a redesign proposal (rare).

## 3. `LESSONS.md` (per skill dir, append-only)

```markdown
# Lessons — scan-sweep

## 1.1 — 2026-08-07 — personas
- Step 3's grep pattern misses TS decorators; anchor on the export keyword.

## 1.1 — 2026-08-09 — nuda-web
### Redesign proposal
- The scan/fix split fights itself on monorepos; per-package passes. (→ 2.0 candidate)
```

- Header names the version the run **used**, not a bump target.
- `### Redesign proposal` flags a major-bump candidate that was NOT applied.
- **Excluded from the skill content hash** and the reference-file listing
  (`skill_files.rs::LESSONS_FILE`): lessons are per-copy run history, not
  method content — including them would mark every copy diverged on any
  append. Install copies still carry the file (`copy_dir_recursive`).
- Mined into the workspace knowledge ladder as `observed` candidates by
  Miner C (`skill_lessons.rs::mine_skill_lessons`, run with the other
  deterministic miners); redesign entries carry a `[redesign]` title prefix.
  The Trace tab lists them via `skill_lessons_list`.

## 4. `.personas/skill-registry.json` (offline orchestration)

Written by the app (`skill_registry_export.rs`) into each managed repo:
on every context scan, after every skill install, and on demand right before
skill dispatches. Git-tracked by design. It tells an **offline** session:

- each installed skill's declared version + sync state + 30d invokes,
- the workspace library's version of the same skill (`library: null` = not in
  the library),
- which sibling projects run it, at which version, with how much recent use.

Versions are the comparison currency (null = implicit 1.0); hashes are not in
the file's contract. The snapshot self-describes `generated_at` and may be up
to one scan old — that staleness tolerance is deliberate.

### The sync ritual (caller-driven, no app required)

When a reflection produced a bump, the session:

1. commits the skill directory as a **standalone commit** on the current
   branch — `skill(<name>): v<new> — <one-line reason>` — nothing else in it;
2. copies the updated directory to `~/.claude/skills/<name>/` (overwrite),
   **unless** the registry file shows the library already carries a higher
   version — then the lesson stays in LESSONS.md with a conflict note and the
   method edit is reconsidered against the newer library copy.

Siblings pick the bump up later through version compare (registry file, Trace
tab drift rings, or their own next adopt). Two projects bumping the same skill
offline can still race the library copy; last write wins there, but both
lessons survive in their repos' LESSONS.md + git history and the miner
resurfaces the losing one.

## Non-goals

- No branching rules for the sync commit (whatever branch is checked out).
- No mass version-stamping of pre-standard skills.
- No hash-based sync between repos: hashes detect drift, versions carry intent.
