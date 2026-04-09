---
name: prime
description: Load behavioral patterns and recent reflections from Obsidian to prime the current session with cross-project self-knowledge
allowed-tools: Read, Glob
---

# Prime — Session Context Loader

Load cross-project behavioral patterns from the shared Obsidian vault so this session benefits from accumulated self-knowledge. Run at the start of a conversation in **any** project.

**Portable by design.** Copy this skill to any repo's `.claude/skills/prime/`. It reads from a shared Obsidian vault, not from project-local files. The patterns it loads are about the user, not any specific codebase.

## Constants

- **Obsidian vault:** `C:/Users/mkdol/Documents/Obsidian/personas`
- **Patterns folder:** `Patterns/` (promoted permanent rules — observed 3+ times)
- **Reflections folder:** `Reflections/` (periodic behavioral analysis from `/reflect`)

## Step 1: Load Promoted Patterns

Glob `C:/Users/mkdol/Documents/Obsidian/personas/Patterns/*.md`. Read each file.

These are permanent, validated behavioral rules — the highest-confidence signals about how the user works. They were promoted from reflections after appearing 3+ times.

If no pattern files exist, skip to Step 2.

## Step 2: Load Recent Reflections

Glob `C:/Users/mkdol/Documents/Obsidian/personas/Reflections/*.md`. Sort by filename (dates sort lexicographically). Read the **3 most recent**.

These contain:
- Current working phase (building / exploring / stabilizing)
- Recent correction patterns (what Claude keeps getting wrong)
- Validated approaches (what the user confirmed works)
- Thinking style observations
- Emerging signals (not yet patterns)

If no reflections exist, tell the user:

> No reflections found yet. Run `/reflect` to analyze your recent sessions and build your behavioral profile. Then `/prime` will have context to load.

Stop here.

## Step 3: Brief the Session

Print a concise primer. Max 10 lines. Format:

```
Session primed — {N} patterns, {M} reflections loaded.

Patterns:
• {pattern — one line each}
• ...

Recent signals:
• {latest correction or emerging signal — one line each}
• ...

Current phase: {from most recent reflection}
```

Rules for the briefing:
- One line per pattern/signal — verb-led, actionable
- Skip anything that's obvious from the codebase or CLAUDE.md
- If a pattern conflicts with the current project's CLAUDE.md, note the conflict but defer to CLAUDE.md (project-local rules win)
- Keep it under 200 words total

## Step 4: Internalize

After presenting the primer, absorb the loaded patterns as soft behavioral defaults for the rest of this session:

- Apply correction patterns proactively — if a pattern says "user dislikes unnecessary error handling," avoid adding it before being asked
- Follow validated approaches when making judgment calls
- Match the user's observed thinking style (delegation level, exploration depth)
- Do NOT mention patterns again unless the user asks or a decision directly hinges on one

The patterns are **defaults, not absolutes**. If the user explicitly asks for something that contradicts a pattern, follow the user. Patterns capture past preferences; the current instruction always wins.
