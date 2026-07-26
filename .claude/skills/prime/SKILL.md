---
name: prime
description: Load behavioral patterns and recent reflections from Obsidian to prime the current session with cross-project self-knowledge
allowed-tools: Read, Glob
---

# Prime — Session Context Loader

Load cross-project behavioral patterns from the shared Obsidian vault so this session benefits from accumulated self-knowledge. Run at the start of a conversation in **any** project.

**Portable by design.** Copy this skill to any repo's `.claude/skills/prime/`. It reads from a shared Obsidian vault, not from project-local files. The patterns it loads are about the user, not any specific codebase.

**Skill family:** `/reflect` analyzes recent sessions and writes `Reflections/` (and promotes repeated signals into `Patterns/`) — this skill reads what `/reflect` writes. `/reflect-me` is the operator-profile sibling (Decision Mirror ledger → behavioral profile), a separate pipeline.

## Constants

- **Obsidian vault:** `C:/Users/kazda/Documents/Obsidian/personas`
- **Patterns folder:** `Patterns/` (promoted permanent rules — observed 3+ times)
- **Reflections folder:** `Reflections/` (periodic behavioral analysis from `/reflect`)

## Step 0: Never fail the session start

This skill is best-effort. If the vault path doesn't exist (different machine, unsynced vault), or a folder is missing or empty, do NOT error or stop the conversation — proceed with whatever IS available and say plainly what was loaded and what wasn't (e.g. "vault not found at <path> — running unprimed" or "2 patterns loaded; no reflections yet — run `/reflect` to create them"). One line per gap, then continue normally.

## Step 1: Load Promoted Patterns

Glob `C:/Users/kazda/Documents/Obsidian/personas/Patterns/*.md`. Read each file.

These are permanent, validated behavioral rules — the highest-confidence signals about how the user works, promoted from reflections after appearing 3+ times. Pattern files are short; read them whole.

## Step 2: Load Recent Reflections

Glob `C:/Users/kazda/Documents/Obsidian/personas/Reflections/*.md`. Sort by filename (dates sort lexicographically). Read the **3 most recent** (or however many exist).

**Excerpt, don't dump.** Pull out only the load-bearing lines — do not recite whole files into the conversation:
- Current working phase (building / exploring / stabilizing)
- Recent correction patterns (what Claude keeps getting wrong)
- Validated approaches (what the user confirmed works)
- Emerging signals (not yet patterns)

If no reflections exist, note it per Step 0 and continue with patterns alone.

## Step 3: Brief the Session

Print a concise primer so the user sees what the session was primed on. Start with a **3–5 line digest**, max 10 lines total:

```
Session primed — {N} patterns, {M} reflections (latest: {date}).

Patterns:
• {pattern — one line each}

Recent signals:
• {latest correction or emerging signal — one line each}

Current phase: {from most recent reflection}
```

Rules for the briefing:
- One line per pattern/signal — verb-led, actionable
- Skip anything that's obvious from the codebase or CLAUDE.md
- If a pattern conflicts with the current project's CLAUDE.md, note the conflict but defer to CLAUDE.md (project-local rules win)
- Keep it under 200 words total; name any gaps (missing vault/folders) in one line

## Step 4: Internalize

After presenting the primer, absorb the loaded patterns as soft behavioral defaults for the rest of this session:

- Apply correction patterns proactively — if a pattern says "user dislikes unnecessary error handling," avoid adding it before being asked
- Follow validated approaches when making judgment calls
- Match the user's observed thinking style (delegation level, exploration depth)
- Do NOT mention patterns again unless the user asks or a decision directly hinges on one

The patterns are **defaults, not absolutes**. If the user explicitly asks for something that contradicts a pattern, follow the user. Patterns capture past preferences; the current instruction always wins.
