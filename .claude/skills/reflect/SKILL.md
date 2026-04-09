---
name: reflect
description: Analyze recent Claude Code sessions and write business-agnostic behavioral reflections to Obsidian
allowed-tools: Bash(node *), Read, Write, Glob
argument-hint: [--days 7] [--focus corrections|patterns|all]
---

# Reflect — Behavioral Pattern Analysis

Analyze recent Claude Code CLI sessions to extract business-agnostic behavioral patterns — how the user thinks, what they correct, what approaches they validate. Write a structured reflection to the shared Obsidian vault.

**This skill is project-agnostic.** It reads transcripts from ALL projects in `~/.claude/projects/` and produces transferable insights about the user's working style, not implementation details about any codebase.

## Constants

- **Obsidian vault:** `C:/Users/mkdol/Documents/Obsidian/personas`
- **Reflections folder:** `Reflections/` (inside vault)
- **Patterns folder:** `Patterns/` (inside vault — promoted permanent rules)
- **Parser:** `.claude/skills/reflect/tools/parse-transcripts.mjs`

When copying this skill to another repo, the vault path stays the same (it's the user's personal knowledge base, shared across all projects). Only the parser path is relative to the repo root.

## Phase 1: Parse Recent Sessions

```bash
node .claude/skills/reflect/tools/parse-transcripts.mjs --days {DAYS} --max-sessions 30
```

Default `{DAYS}` is 7 unless the user passed `--days N`. The parser:
- Filters out automated sessions (build pipelines, test runners, evals)
- Strips system-injected content from user messages
- Detects corrections, positive signals, task categories, tool usage
- Returns aggregated JSON to stdout

If `sessionsAnalyzed` is 0, tell the user no recent sessions were found and stop.

## Phase 2: Load Previous Context

1. Glob `C:/Users/mkdol/Documents/Obsidian/personas/Reflections/*.md` — read the 2 most recent (by filename date) for continuity.
2. Read all `C:/Users/mkdol/Documents/Obsidian/personas/Patterns/*.md` to know which rules are already promoted.

If neither folder has files, this is the first reflection — skip continuity analysis.

## Phase 3: Synthesize Reflection

Analyze the parser output. Focus entirely on **behavioral signals that transfer across projects**.

### Extract these categories:

**Correction patterns** — What does the user repeatedly correct?
- Generalize away from specifics: "stop adding try-catch wrappers" → *"Prefers minimal error handling — only at system boundaries"*
- "don't mock the database" → *"Values integration tests over mocks"*
- Look for clusters: multiple corrections pointing at one underlying preference

**Validated approaches** — What positive signals confirm?
- "perfect, the bundled PR was right" → *"Prefers bundled PRs for related changes"*
- Quieter than corrections but equally important for calibration

**Request patterns** — What work categories dominate?
- Heavy research + design = architectural phase
- Heavy feature + UI = building phase
- Heavy debugging + testing = stabilization phase

**Tool usage style** — How does the user work with Claude?
- High Read/Grep before Edit → exploration-first, understand before changing
- Edit >> Write → surgical changes over file rewrites
- Agent usage → delegation preferences

**Interaction style** — How does the user communicate?
- Long initial prompts → detailed specs upfront
- Many short exchanges → iterative refinement
- Correction rate → alignment gap

### Abstraction rule:

For every insight, ask: **"Would this still be true if the user switched to a completely different project?"**
- Yes → keep it
- No → generalize until it is
- Example: "User wants Zustand, not Redux" → keep (it's a technology preference)
- Example: "PersonaMatrix table has 12 columns" → discard (implementation detail)

### What to EXCLUDE:

- Specific file paths, function names, variable names, table schemas
- Project-specific architecture decisions
- Code snippets
- Technology names UNLESS the preference is about the technology itself

## Phase 4: Write to Obsidian

Ensure the folder exists:

```bash
node -e "require('fs').mkdirSync('C:/Users/mkdol/Documents/Obsidian/personas/Reflections', {recursive:true})"
```

Write to `C:/Users/mkdol/Documents/Obsidian/personas/Reflections/YYYY-MM-DD-reflection.md` (today's date). If a file for today exists, append counter: `-reflection-2.md`.

### Output format:

```markdown
---
date: {YYYY-MM-DD}
period: {N}d
sessions: {N}
corrections: {N}
positive_signals: {N}
top_categories: [{cat1}, {cat2}, {cat3}]
---

## Working Phase

{One sentence: what phase dominates — exploration, building, stabilizing, etc.}

## Correction Patterns

{Bullets. Lead with the generalized rule, brief "e.g." if helpful.}

- **{Pattern name}** — {Description}

## Validated Approaches

{Confirmed approaches — same format.}

- **{Pattern name}** — {Description}

## Thinking Style

{2-3 sentences: delegation level, exploration depth, iteration speed, spec detail.}

## Emerging Signals

{New observations from this period — not yet patterns, but worth watching.}

- {Signal}

## Continuity

{Compare with previous reflections: what changed, what held, what's trending. Skip if first reflection.}
```

## Phase 5: Pattern Promotion

Scan the reflection just written PLUS previous reflections. If any signal has appeared in 3+ reflections:

1. Check `Patterns/*.md` — skip if already promoted.
2. Create `C:/Users/mkdol/Documents/Obsidian/personas/Patterns/cli-{slug}.md`:

```markdown
---
promoted: {YYYY-MM-DD}
source: reflections
observations: {N}
---

## {Pattern Name}

{Clear, actionable statement.}

**Applies when:** {Conditions}
**Counter-signal:** {When this should NOT apply}
```

3. Note the promotion in the reflection's Continuity section.

## Phase 6: Summary

Print to the user:

```
Reflection written → Reflections/{filename}

  Period:       {N}d ({M} sessions, {P} projects)
  Corrections:  {N} — top: {top pattern}
  Confirmed:    {N}
  Phase:        {phase}
  Promoted:     {N} new patterns
```
