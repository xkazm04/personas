# Personas Harness Guide

> Autonomous Plan → Execute → Verify loop for codebase-wide goals.
> Adapted from the PoF harness pattern (Anthropic harness engineering).

## What is the Harness?

The Harness is a **reusable autonomous framework** that breaks large codebase goals into dependency-sorted areas, executes each area in a dedicated Claude Code session, verifies the result through quality gates, and accumulates learnings for subsequent iterations.

**Core loop:** `PLAN → EXECUTE → VERIFY → RECORD → ITERATE`

One harness run can process 20-100+ areas to achieve a codebase-wide goal (e.g., "migrate all typography to tokens" or "add i18n to every component").

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Harness Orchestrator                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │  Planner  │→│ Executor  │→│ Verifier  │→│  Recorder   │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
│       ↑                                          │          │
│       └──────────── iterate ─────────────────────┘          │
│                                                             │
│  State: .harness/plan.json, progress.json, guide.json       │
│  Output: guide.md, learnings.md                             │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| **Types** | `src/lib/harness/types.ts` | Complete type system for plans, areas, features, gates, events |
| **Orchestrator** | `src/lib/harness/orchestrator.ts` | Core loop: plan → execute → verify → record |
| **Plan Builder** | `src/lib/harness/plan-builder.ts` | Generates area plan from scenario definition |
| **Executor** | `src/lib/harness/executor.ts` | Spawns Claude Code sessions per area |
| **Verifier** | `src/lib/harness/verifier.ts` | Runs quality gates after each execution |
| **Guide Generator** | `src/lib/harness/guide-generator.ts` | Builds reproducible playbook |
| **CLI Runner** | `src/lib/harness/run-harness.ts` | Standalone CLI entry point |

---

## How It Works

### 1. Planning

The planner reads a **scenario definition** (e.g., `harness-scenario.md`) and generates a `GamePlan`:

- **Areas** — cohesive units of work (e.g., "agents/ typography migration")
- **Features** — trackable items within each area (e.g., "ChatThread.tsx uses typo-* classes")
- **Dependencies** — topological ordering (foundation areas first)
- **Verification Gates** — quality checks per area

### 2. Execution

For each area, the executor:

1. Assembles a prompt with: project context, area spec, accumulated learnings, recent progress
2. Spawns `claude -p` with the prompt and allowed tools (Read, Edit, Write, Glob, Grep, Bash)
3. Captures structured result via `@@HARNESS_RESULT` markers
4. Extracts: files changed, features completed, new learnings

### 3. Verification

After execution, gates run automatically:

| Gate | Command | Required | Description |
|------|---------|----------|-------------|
| **typecheck** | `npx tsc --noEmit` | Yes | TypeScript compilation |
| **lint** | `npm run lint` | Yes | ESLint rules |
| **build** | `npx vite build` | No | Production build |
| **custom** | Per-scenario | Varies | Scenario-specific audits |

### 4. Recording

After verification:
- Feature statuses updated (pass/fail)
- Progress entry appended with duration, errors, learnings
- Guide step generated for completed areas
- `AGENTS.md` updated with new learnings
- Pass rate recalculated

### 5. Iteration

Loop continues until:
- `passRate >= targetPassRate` (default: 90%)
- All areas completed/exhausted
- `maxIterations` reached

---

## Personas-Specific Adaptations

### Tech Stack Context

Unlike the PoF harness (UE5/C++), the Personas harness targets:

- **Frontend**: React 19 + TypeScript + Tailwind 4 + Zustand
- **Backend**: Rust (Tauri) with SQLite
- **Build**: Vite + tsc
- **Desktop**: Tauri v2 APIs (notifications, shell, dialogs)

### Area Grouping Strategy

Areas map to feature directories under `src/features/`:

```
src/features/
├── agents/          → 8-12 areas (largest feature)
├── overview/        → 6-8 areas (sub-pages)
├── triggers/        → 4-5 areas
├── settings/        → 2-3 areas
├── templates/       → 3-4 areas
├── plugins/         → 2-3 areas
├── shared/          → 3-4 areas (components, hooks)
├── home/            → 1 area
└── schedules/       → 1-2 areas
```

### Verification Gates for Personas

```typescript
const PERSONAS_GATES: VerificationGate[] = [
  { name: 'typecheck',  type: 'typecheck', required: true,  command: 'npx tsc --noEmit' },
  { name: 'lint',       type: 'lint',      required: true,  command: 'npm run lint' },
  { name: 'build',      type: 'build',     required: false, command: 'npx vite build' },
  // Scenario-specific gates added per run
];
```

---

## Running the Harness

### CLI

```bash
npx tsx src/lib/harness/run-harness.ts \
  --scenario docs/harness/harness-scenario.md \
  --project "C:/Users/kazda/kiro/personas" \
  --name "personas" \
  [--max-iterations 100] \
  [--target-pass-rate 90] \
  [--timeout 600000] \
  [--state-path ".harness"] \
  [--dry-run]
```

### Dry Run (preview plan)

```bash
npx tsx src/lib/harness/run-harness.ts \
  --scenario docs/harness/harness-scenario.md \
  --project "C:/Users/kazda/kiro/personas" \
  --name "personas" \
  --dry-run
```

### Resume After Interruption

State persists to `.harness/`. Just re-run the same command — the orchestrator detects existing state and resumes from the last completed area.

---

## Output Artifacts

```
.harness/
├── plan.json          # Current state: areas, features, status, stats
├── progress.json      # Chronological log of all iterations
├── guide.json         # Structured guide (machine-readable)
├── guide.md           # Reproducible playbook (human-readable)
└── AGENTS.md          # Accumulated learnings (fed into next sessions)
```

### Guide Format

Each completed area produces a guide step:

```markdown
## Phase 12: agents/components — Typography Migration

**Area:** agents-components-typography
**Module:** typography
**Duration:** 245s

### Actions Taken
- Replaced text-sm with typo-body in 34 files
- Replaced text-xs with typo-caption in 12 files
- Added typo-heading to section headers

### Files Modified
- src/features/agents/components/ChatThread.tsx
- src/features/agents/components/PersonaCard.tsx
- ...

### Decisions
- Used typo-body (not typo-caption) for inline descriptions — maintains readability at compact scale

### Gotchas
- Recharts components use inline fontSize for SVG — cannot use CSS classes, kept as-is
- Some Tailwind text-* classes are for color (text-foreground), not size — don't replace those

### Verification
- typecheck: PASS
- lint: PASS
- typography-audit: PASS (0 raw text-size classes remaining in area)
```

---

## Creating a New Scenario

To run the harness against a different goal:

1. Create `docs/harness/my-scenario.md` with:
   - **Goal description** — what success looks like
   - **Current state** — audit of where things stand
   - **Area definitions** — grouped by feature/module
   - **Feature checklist** — trackable items per area
   - **Custom gates** — scenario-specific verification
   - **Dependencies** — which areas must complete first

2. Run: `npx tsx src/lib/harness/run-harness.ts --scenario docs/harness/my-scenario.md ...`

See `docs/harness/harness-scenario.md` for a complete example.

---

## Key Design Patterns

### 1. One Area = One Session
Each area is a cohesive unit that fits in Claude's context. The session gets full domain context, all feature definitions, and accumulated learnings.

### 2. State Persistence
All state lives in JSON files. Survives process kills, context resets, and network interruptions.

### 3. Dependency Resolution
Topological sort ensures foundation areas complete before dependent ones.

### 4. Feature-Level Tracking
Per-feature status enables fine-grained quality assessment and targeted retries.

### 5. Learnings Accumulation
Every session produces learnings appended to `AGENTS.md`. Next session reads them all — prevents repeated mistakes.

### 6. Event-Driven Monitoring
15+ event types enable real-time progress tracking via CLI or UI integration.

### 7. Structured Result Markers
`@@HARNESS_RESULT` / `@@END_HARNESS_RESULT` markers make result extraction robust.

### 8. Graceful Interruption
Ctrl+C triggers pause → save state → resume later with no lost work.

---

## Cleanup

After a harness run:

```bash
# Archive results to docs
cp .harness/guide.md docs/harness/
cp .harness/AGENTS.md docs/harness/harness-learnings.md

# Remove temporary state
rm -rf .harness/

# Clean worktrees if any
git worktree prune
```

---

## Cost & Timeline Estimates

| Scenario Size | Areas | Estimated Duration | Estimated Cost |
|---------------|-------|-------------------|----------------|
| Small (1 goal) | 10-20 | 1-2 hours | $5-15 |
| Medium (2-3 goals) | 30-50 | 3-5 hours | $15-35 |
| Large (full codebase) | 50-100 | 5-10 hours | $25-75 |

The 3-goal scenario (typography + i18n + notifications) is ~45 areas, estimated 4-6 hours.
