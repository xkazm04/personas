# skills_sidecar — per-connector SKILL.md writer

> Source: `/research` run 2026-05-09 ("Printing Press" walkthrough by Nate Herk).
> Sibling pattern to `hooks_sidecar.rs` (Karpathy run 2026-04-08).

## Why this exists

Today, `engine/prompt/mod.rs` injects a `## Connector Usage Reference` section
that bakes every bound connector's `metadata.llm_usage_hint` (overview +
examples + gotchas) into the system prompt up front. The agent pays the token
cost for **every** bound connector's docs **every turn**, even when only one
connector ends up being used.

Claude Code natively scans `.claude/skills/<name>/SKILL.md` files in its working
directory and treats each folder as a callable skill. Skills are
**lazy-loaded**: the agent sees a 1-line description up front and only loads
the full body when it decides to invoke the skill. That's the affordance
Printing Press's "lazy discovery + pre-formatted output" pitch is built on.

## What this module does

For each connector bound to the persona (0-3 per persona — see
`codebase-stack.md` §3 catalog-vs-runtime distinction), `install_sidecar`
writes:

```
exec_dir/.claude/skills/personas-connector-{slug}/SKILL.md
```

Body composed from the existing `LlmUsageHint` shape (no schema changes):

- `overview` → 1-paragraph intro
- `examples` → fenced code blocks, one per example
- `gotchas` → bullet list

Plus a small "How to invoke" block pointing the agent at the credential proxy.

## Env-gated rollout

Like `hooks_sidecar`, this is opt-in via env var
`PERSONAS_SKILLS_SIDECAR=1`. When unset, both the writer and the prompt
module's shrink path are no-ops — production behavior is unchanged.

When the env var is **set**:
1. `install_sidecar` writes SKILL.md per bound connector.
2. `prompt::assemble_prompt`'s `Connector Usage Reference` section shrinks to a
   list of names + 1-line "see skill" pointers — full body lives in the skill
   files instead.

Both halves ship together. Setting the env without the prompt shrink is a
**net token regression** (skills add cost without removing inline cost), and
shrinking the prompt without writing the skills means the LLM sees pointers to
non-existent files. The shared env gate enforces lockstep.

## Skill name prefix

All skill folders use the `personas-connector-` prefix to avoid colliding with
user-authored skills the user might have in their project's `.claude/skills/`.

## What this is NOT

- **Not a connector schema change.** The body composition reads existing
  `metadata.llm_usage_hint` fields. Connectors that don't ship a hint produce
  no skill file (same as today's prompt section: nothing to inject).
- **Not user-editable per execution.** Files are rewritten every run.
  Persistent customisation belongs in the connector JSON, not the exec_dir.
- **Not one-skill-per-action.** Start with one skill per connector. If usage
  data shows the agent ignores the bottom of the SKILL.md body, escalate to
  per-action granularity later.
- **Not a replacement for the credential proxy section.** The
  `## Available Credentials (via secure proxy)` section in the system prompt
  stays — it documents the mechanics of `$PERSONAS_PROXY_URL` and is shared
  infrastructure, not per-connector content.

## Cleanup

`exec_dir` is per-execution and torn down by the existing runner lifecycle.
Stale skill folders cannot survive across runs because each run gets a fresh
`exec_dir`. No explicit cleanup needed.

## Testing

- `build_skill_md_renders_full_body` — every field maps to a section.
- `build_skill_md_handles_missing_gotchas` — `Option::None` produces no
  Gotchas heading.
- `install_sidecar_disabled_is_noop` — env unset → returns `Ok(false)` and
  writes nothing.
- `install_sidecar_writes_one_file_per_hint` — env set → one SKILL.md per
  passed hint, each at the correct path.
- `slug_for_connector_name` — kebab-case round-trip including non-trivial
  inputs (uppercase, underscores).
