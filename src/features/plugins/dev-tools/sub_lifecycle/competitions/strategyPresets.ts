/**
 * Adaptive strategy system for competitions.
 *
 * Instead of 4 fixed presets, strategies are composed from weighted "genes"
 * (emphasis dimensions). Each gene ranges 0–10. The combination produces
 * a unique strategy prompt per slot.
 *
 * After each competition, winning genes get boosted and failed genes get
 * penalized — over time the system converges on what works for this project.
 */

// ---------------------------------------------------------------------------
// Gene definitions
// ---------------------------------------------------------------------------

export interface StrategyGenes {
  /** 0 = touch minimum files, 10 = tackle the full feature surface */
  scope: number;
  /** 0 = skip tests, 10 = write tests before implementation */
  testing: number;
  /** 0 = change nothing outside the task, 10 = clean up everything you touch */
  refactoring: number;
  /** 0 = start coding immediately, 10 = deep codebase research first */
  analysis: number;
  /** 0 = one big commit, 10 = tiny commits per logical change */
  commitFrequency: number;
  /** 0 = use proven patterns only, 10 = try novel approaches */
  riskAppetite: number;
}

const GENE_KEYS: (keyof StrategyGenes)[] = [
  'scope', 'testing', 'refactoring', 'analysis', 'commitFrequency', 'riskAppetite',
];

// ---------------------------------------------------------------------------
// Prompt generation from genes
// ---------------------------------------------------------------------------

function geneDirective(key: keyof StrategyGenes, value: number): string {
  const low = value <= 3;
  const high = value >= 7;

  switch (key) {
    case 'scope':
      return low ? 'Keep the change surface minimal — touch only the files directly required.'
        : high ? 'Cover the full feature surface — wire into every relevant entry point and UI surface.'
        : 'Balance scope: cover the core functionality without unnecessary breadth.';
    case 'testing':
      return low ? 'Focus on implementation. Add tests only if they directly verify the core change.'
        : high ? 'Write tests FIRST. Every new function gets at least one test. Tests prove the change works before you move on.'
        : 'Add tests for the main happy path and one edge case.';
    case 'refactoring':
      return low ? 'Do NOT refactor or rename anything outside the immediate task scope.'
        : high ? 'When you see duplication, unclear names, or long functions in the files you touch — clean them up.'
        : 'Light cleanup is fine if it directly improves the code you are modifying.';
    case 'analysis':
      return low ? 'Start implementing quickly. Read the target files, understand the pattern, and begin.'
        : high ? 'Before writing any code: search the codebase for related patterns, check if similar features exist, understand the architectural context.'
        : 'Briefly scan for existing patterns before implementing.';
    case 'commitFrequency':
      return low ? 'Commit once when the task is complete.'
        : high ? 'Commit after each logical sub-step. Run the build after each commit to catch errors early.'
        : 'Commit at natural breakpoints (e.g., after each sub-task).';
    case 'riskAppetite':
      return low ? 'Use established patterns from the existing codebase. Match the conventions you see.'
        : high ? 'If you see a better architectural approach, propose it. Don\'t just copy existing patterns — improve them if justified.'
        : 'Follow existing patterns but suggest improvements in PR notes if you see better options.';
  }
}

// ---------------------------------------------------------------------------
// Milestone definitions for progress racing visualization
// ---------------------------------------------------------------------------

export interface Milestone {
  id: string;
  label: string;
  progressPct: number;
  color: string;
}

export const MILESTONES: Milestone[] = [
  { id: 'analyzing', label: 'Analyzing', progressPct: 10, color: 'blue' },
  { id: 'planning', label: 'Planning', progressPct: 25, color: 'indigo' },
  { id: 'implementing', label: 'Implementing', progressPct: 55, color: 'violet' },
  { id: 'testing', label: 'Testing', progressPct: 80, color: 'amber' },
  { id: 'committing', label: 'Committing', progressPct: 95, color: 'emerald' },
  { id: 'done', label: 'Done', progressPct: 100, color: 'emerald' },
];

const MILESTONE_INSTRUCTION = `
## Progress Reporting (IMPORTANT)
As you work, emit progress markers so the user can track your progress.
At each stage, output a line in EXACTLY this format:

[Progress] {"milestone": "<id>", "detail": "<what you just did>"}

The milestone IDs in order: analyzing, planning, implementing, testing, committing, done.
Example: [Progress] {"milestone": "implementing", "detail": "Added rate limiter middleware to auth routes"}

Emit at least one progress marker per stage you go through.`;

export function generateStrategyPrompt(label: string, genes: StrategyGenes): string {
  const directives = GENE_KEYS
    .map((key) => `- **${key}** (${genes[key]}/10): ${geneDirective(key, genes[key])}`)
    .join('\n');

  return `## Strategy: ${label}

Your approach for this task is defined by the following emphasis weights.
Follow these directives — they determine how you balance trade-offs.

${directives}

Remember: the goal is to PRODUCE WORKING CODE that solves the task.
Do not over-analyze or over-plan. Start implementing once you understand the task.
If stuck, try a simpler approach rather than abandoning the task.
${MILESTONE_INSTRUCTION}`;
}

// ---------------------------------------------------------------------------
// Strategy generation — diverse gene combinations per run
// ---------------------------------------------------------------------------

export interface StrategyPreset {
  label: string;
  genes: StrategyGenes;
  prompt: string;
  tagline: string;
}

/** Clamp a number to [0, 10] */
function clamp(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n)));
}

/** Add random jitter ±spread to a value, clamped to [0, 10] */
function jitter(base: number, spread: number = 2): number {
  return clamp(base + (Math.random() * 2 - 1) * spread);
}

/** Generate a human-readable tagline from gene weights */
function generateTagline(genes: StrategyGenes): string {
  const traits: string[] = [];
  if (genes.scope >= 7) traits.push('broad scope');
  else if (genes.scope <= 3) traits.push('narrow focus');
  if (genes.testing >= 7) traits.push('test-heavy');
  if (genes.analysis >= 7) traits.push('research-first');
  else if (genes.analysis <= 3) traits.push('dive-in');
  if (genes.riskAppetite >= 7) traits.push('innovative');
  else if (genes.riskAppetite <= 3) traits.push('conservative');
  if (genes.refactoring >= 7) traits.push('cleanup-friendly');
  return traits.length > 0 ? traits.join(', ') : 'balanced';
}

/**
 * Generate N diverse strategy presets with randomized gene combinations.
 *
 * If `previousWinnerGenes` is provided (from the last competition's winner),
 * the first slot gets genes biased toward the winner (exploitation).
 * Other slots get random diverse combinations (exploration).
 */
export function generateStrategies(
  count: number,
  previousWinnerGenes?: StrategyGenes | null,
): StrategyPreset[] {
  const strategies: StrategyPreset[] = [];
  const labels = ['Alpha', 'Beta', 'Gamma', 'Delta'];

  for (let i = 0; i < count; i++) {
    let genes: StrategyGenes;

    if (i === 0 && previousWinnerGenes) {
      // Slot 0: exploit — bias toward previous winner with light jitter
      genes = {
        scope: jitter(previousWinnerGenes.scope, 1),
        testing: jitter(previousWinnerGenes.testing, 1),
        refactoring: jitter(previousWinnerGenes.refactoring, 1),
        analysis: jitter(previousWinnerGenes.analysis, 1),
        commitFrequency: jitter(previousWinnerGenes.commitFrequency, 1),
        riskAppetite: jitter(previousWinnerGenes.riskAppetite, 1),
      };
    } else {
      // Other slots: explore — random diverse combinations
      genes = {
        scope: clamp(Math.floor(Math.random() * 11)),
        testing: clamp(Math.floor(Math.random() * 11)),
        refactoring: clamp(Math.floor(Math.random() * 11)),
        analysis: clamp(Math.floor(Math.random() * 11)),
        commitFrequency: clamp(Math.floor(Math.random() * 11)),
        riskAppetite: clamp(Math.floor(Math.random() * 11)),
      };
    }

    const label = labels[i] ?? `Strategy ${i + 1}`;
    strategies.push({
      label,
      genes,
      prompt: generateStrategyPrompt(label, genes),
      tagline: generateTagline(genes),
    });
  }

  return strategies;
}

/**
 * Mutate a losing strategy's genes toward the winner's genes
 * with some random exploration. Used for strategy evolution.
 */
export function mutateTowardWinner(
  loser: StrategyGenes,
  winner: StrategyGenes,
  learnRate: number = 0.3,
): StrategyGenes {
  const mutated: StrategyGenes = { ...loser };
  for (const key of GENE_KEYS) {
    const delta = winner[key] - loser[key];
    mutated[key] = clamp(loser[key] + delta * learnRate + (Math.random() - 0.5) * 2);
  }
  return mutated;
}
