// What each passport action ACTUALLY does — the content behind the consent
// gate. Split out of PassportActionsRow because the honest version of "what am
// I agreeing to" is prose, not a tooltip: a one-line framing, the ordered steps
// the click sets off, the boundaries that hold no matter what, and a few
// at-a-glance facts (scope / engine / duration / what it writes).
//
// Everything here must stay TRUE of the code paths in PassportActionsRow —
// dispatchSkillToRepo + onboardDispatch (onboard), StandardsScan's
// FindingsPopover (standards), passportExport (copy), usePassportData's
// rescanProject (rescan), and ImprovePlanPanel (plan). If a flow changes,
// change its steps in the same edit.
import { Compass, FileDown, RefreshCw, ShieldCheck, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** read = nothing is written · write = touches the repo or config ·
 *  agent = spawns a Claude session that can write once you answer it. */
export type ActionImpact = 'read' | 'write' | 'agent';

export interface ActionFact {
  label: string;
  value: string;
}

export interface ActionSpec {
  id: string;
  icon: LucideIcon;
  /** Trigger-button tooltip. */
  tooltip: string;
  /** Modal heading. */
  title: string;
  impact: ActionImpact;
  /** One sentence: what this is, in the user's terms. */
  summary: string;
  /** Ordered — exactly what the click sets off, step by step. */
  steps: string[];
  /** What holds regardless — the reason it's safe to click. */
  boundaries: string[];
  facts: ActionFact[];
  confirmLabel: string;
}

export const IMPACT_META: Record<ActionImpact, { label: string; hue: string }> = {
  read: { label: 'Read-only', hue: '#34D399' },
  write: { label: 'Writes when you confirm', hue: '#F59E0B' },
  agent: { label: 'Runs an agent session', hue: '#8B5CF6' },
};

/** Shorten a repo root for a fact chip — the tail is the identifying part. */
function shortRoot(root: string | null | undefined): string {
  if (!root) return 'the project repo';
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.length <= 2 ? root : `…/${parts.slice(-2).join('/')}`;
}

/** The five per-project actions, with the target's own name/root folded in. */
export function buildActionSpecs(name: string, root: string | null | undefined): ActionSpec[] {
  const where = shortRoot(root);
  return [
    {
      id: 'onboard',
      icon: Compass,
      tooltip: 'Onboard with Fleet',
      title: `Onboard ${name} with Fleet`,
      impact: 'agent',
      summary:
        `Spawns a Claude terminal inside ${name}'s repo running the guided onboarding skill. It walks every passport dimension with you and executes only the work you accept.`,
      steps: [
        'Copies the app’s `passport-onboard` skill into the repo’s `.claude/skills`, a deterministic file copy, no model and no tokens, so the slash command resolves there.',
        'Composes the briefing from this passport: the dimension snapshot, the project’s binding slots, and the NAMES and types of your Vault connectors.',
        'Spawns one Fleet session in the repo root (keyed `passport:onboard:<slug>`) and invokes `/passport-onboard` with that briefing.',
        'The session assesses each dimension, then offers you batched skip / path-A / path-B choices in the terminal.',
        'Seeds the project’s first Ship milestone (“Onboard to Personas”) so its roadmap opens with a live deliverable.',
      ],
      boundaries: [
        'Credential VALUES never leave the vault. Only connector names and service types are sent.',
        'The session changes nothing in the repo until you answer its prompts.',
        'One session per project: while a run is live, the icon opens its terminal instead of spawning a second.',
        'Closing the terminal stops the run; the passport itself is unaffected.',
      ],
      facts: [
        { label: 'Runs in', value: where },
        { label: 'Engine', value: 'Fleet · Claude session' },
        { label: 'Duration', value: 'Interactive, minutes' },
        { label: 'Cost', value: 'LLM tokens' },
      ],
      confirmLabel: 'Start session',
    },
    {
      id: 'standards',
      icon: ShieldCheck,
      tooltip: 'Standards scan & fixes',
      title: `Standards scan & fixes: ${name}`,
      impact: 'write',
      summary:
        'Opens the golden-standard findings for this project: every open finding by severity, each with a one-click fix.',
      steps: [
        'Reads this project’s stored standards and shows the current compliance percentage.',
        'Offers a fresh scan of the repo (an LLM pass) when you want the findings re-derived.',
        'Lists each open finding grouped by severity (critical, warning, info) with its recommendation.',
        'Gives each finding a fix: an instant config toggle where it maps to a Tier-0 setting, otherwise a “Fix with Claude” task built from the finding’s own recommendation.',
      ],
      boundaries: [
        'Opening the list modifies nothing. The scan only reads.',
        'Fixes apply one at a time, and only on the click that applies them.',
        '“Fix with Claude” queues a task for review; it never runs unattended.',
      ],
      facts: [
        { label: 'Scope', value: `${name} only` },
        { label: 'Engine', value: 'Standards scan (LLM)' },
        { label: 'Duration', value: 'Under a minute' },
        { label: 'Writes', value: 'Only the fix you click' },
      ],
      confirmLabel: 'Open findings',
    },
    {
      id: 'copy',
      icon: FileDown,
      tooltip: 'Copy readiness report',
      title: `Copy ${name}’s readiness report`,
      impact: 'read',
      summary:
        'Puts a public-safe markdown readiness report for this project on your clipboard.',
      steps: [
        'Renders the passport as markdown: automation level, production band, the per-dimension levels, the golden-standard score and the open blockers.',
        'Keeps it public-safe: no credentials, no cost figures, no local file paths.',
        'Copies it to your clipboard, ready to paste into a README, a PR description or an issue.',
      ],
      boundaries: [
        'Nothing leaves this machine. No network call is made.',
        'No file is written; the repo is untouched.',
      ],
      facts: [
        { label: 'Output', value: 'Markdown → clipboard' },
        { label: 'Duration', value: 'Instant' },
        { label: 'Network', value: 'None' },
        { label: 'Writes', value: 'None' },
      ],
      confirmLabel: 'Copy report',
    },
    {
      id: 'rescan',
      icon: RefreshCw,
      tooltip: 'Rescan this project',
      title: `Rescan ${name}`,
      impact: 'read',
      summary:
        'Re-aggregates only this project’s metadata and re-derives its passport from the fresh data.',
      steps: [
        'Re-reads this project’s registered metadata and its scan artifacts.',
        'Re-derives every passport dimension (stack, tooling, readiness) from that fresh read.',
        'Leaves every other project on its last scan, sparing the full cross-project pass.',
        'Swaps this column in place the moment it lands; the wall stays where you are.',
      ],
      boundaries: [
        'Read-only: nothing in the repo is modified.',
        'Other projects’ passports are untouched.',
      ],
      facts: [
        { label: 'Scope', value: `${name} only` },
        { label: 'Engine', value: 'Metadata aggregation' },
        { label: 'Duration', value: 'Seconds' },
        { label: 'Writes', value: 'None' },
      ],
      confirmLabel: 'Rescan',
    },
    {
      id: 'plan',
      icon: Target,
      tooltip: 'Improve plan (this project)',
      title: `Improve plan for ${name}`,
      impact: 'write',
      summary:
        'Builds a focused improvement plan for this project: every below-target gap ranked by impact-per-effort.',
      steps: [
        'Collects every dimension of this passport currently sitting below its golden target.',
        'Ranks them by impact-per-effort and shows the golden score now versus projected, if the selected work lands.',
        'Types each item by what it actually needs: a config toggle, a context scan, a connector to wire, a skill to place, or a Claude deploy task.',
        'Batch-queues whatever you select. Claude tasks land in review, they do not start on their own.',
      ],
      boundaries: [
        'Opening the plan changes nothing.',
        'Queued tasks wait for your review before any of them runs.',
        'Scoped to this project; the fleet-wide program lives elsewhere.',
      ],
      facts: [
        { label: 'Scope', value: `${name} only` },
        { label: 'Output', value: 'Ranked gap list' },
        { label: 'Duration', value: 'Instant' },
        { label: 'Writes', value: 'Only what you queue' },
      ],
      confirmLabel: 'Build plan',
    },
  ];
}
