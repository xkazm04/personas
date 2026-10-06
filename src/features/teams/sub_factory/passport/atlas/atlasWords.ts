// Every word the Passport Atlas shows, in one list — the Factory's convention
// (see useFactoryWords.ts: the Factory has never had an i18n pass, and its owed
// pass translates one list instead of literals across files). The state names
// and the Tone x Glyph each ink draws are here too, so a state reads the same
// in the matrix, the drawer, the passport and the legend.
import type { Glyph, Tone } from '@/features/shared/components/kit';
import type { AtlasInk, AtlasLens, AtlasSort } from './atlasModel';

export const ATLAS_WORDS = {
  tabAtlas: 'Atlas',
  tabWall: 'Wall',
  tabsLabel: 'Passport view',
  eyebrowPortfolio: 'App readiness passports',
  eyebrowPassport: 'App readiness passport',
  finding: (n: number, below: number, dims: number) =>
    `${n} projects · ${below} below 45% of their golden standard · ${dims} dimensions fail somewhere`,
  reasons: (name: string, n: number) => (n === 0 ? `${name} · ready, no blockers` : `${name} · ${n} reason${n === 1 ? '' : 's'} it is not ready`),
  repositories: 'Repositories',
  needCare: 'Need care',
  repoUnknown: 'Repo unknown',
  portfolio: 'Portfolio',
  lens: 'Lens',
  sort: 'Sort',
  find: 'Find a project',
  sharedSetup: (n: number) => `${n} shared setup`,
  sharedSetupTitle: 'Not set up on any project',
  sharedSetupNote: 'These dimensions read "not set up" on every project, so their columns are folded out of the matrix. Each passport still lists them with its door.',
  unfold: 'Show in matrix',
  fold: 'Fold again',
  repository: 'Repository',
  gaps: 'Gaps',
  auto: 'Auto',
  prod: 'Prod',
  below: (n: number) => `${n} below`,
  noMatch: 'No projects match',
  noMatchHint: 'Try a name or a repository path.',
  clearSearch: 'Clear search',
  keysPortfolio: '↑ ↓ projects · ← → dimensions · Enter details · P passport · / find',
  keysLedger: 'A row is a dimension · a name opens that cell · / find',
  keysDossier: 'A card opens its passport · a named gap opens that cell · / find',
  figure: 'Figure',
  below2: 'Below',
  attention: 'Attention',
  healthy: 'Healthy',
  unverified: 'Unverified',
  dimension: 'Dimension',
  projectsBelow: 'Projects below readiness',
  noneBelow: 'None',
  more: (n: number) => `+${n}`,
  gapsOf: (n: number) => `${n} gaps`,
  allClear: 'No dimension is below readiness.',
  scoresOf: (auto: number | string, prod: number | string) => `Auto ${auto} · Prod ${prod}`,
  dossierLabel: 'Projects',
  ledgerLabel: 'Dimensions across the portfolio',
  keysPassport: '[ ] previous / next project · Esc portfolio',
  openPassport: 'Open passport',
  close: 'Close',
  back: 'Portfolio',
  prev: 'Previous project',
  next: 'Next project',
  automation: 'Automation',
  production: 'Production',
  golden: 'Golden standard',
  blockers: 'Blockers',
  whyNotReady: "Why it's not ready",
  noBlockers: 'Ready, no blockers.',
  contents: 'In this passport',
  overview: 'Overview',
  unreadable: 'This repository could not be read.',
  unreadableNote: 'The checkout is missing on disk. Repository-derived rows say Unknown because nothing was measured; database configuration is still known. Rescan once the checkout exists, or remove the project.',
  rung: (i: number, n: number) => `rung ${i} of ${n}`,
  here: 'here',
  improve: 'Improve',
  setUp: 'Set up',
  working: 'An agent is working on this row',
  openTerminal: 'Open terminal',
  notConfigured: 'Not configured',
  openWorkspace: 'Open workspace',
} as const;

/** The portfolio FIGURE the owner is comparing (dev-only switcher). */
export const FIGURES: ReadonlyArray<{ v: 'matrix' | 'ledger' | 'dossier'; label: string }> = [
  { v: 'matrix', label: 'Matrix' },
  { v: 'ledger', label: 'Ledger' },
  { v: 'dossier', label: 'Dossier' },
];

export const LENSES: ReadonlyArray<{ v: AtlasLens; label: string }> = [
  { v: 'readiness', label: 'Readiness' },
  { v: 'production', label: 'Production' },
  { v: 'automation', label: 'Automation' },
  { v: 'stack', label: 'Stack' },
  { v: 'tooling', label: 'Tooling' },
];

export const SORTS: ReadonlyArray<{ v: AtlasSort; label: string }> = [
  { v: 'production', label: 'Prod ↑' },
  { v: 'automation', label: 'Auto ↑' },
  { v: 'name', label: 'Name' },
  { v: 'gap', label: 'Gap ↓' },
];

/** Column heads short enough to sit horizontally; the full label is in the drawer and the passport. */
export const SHORT_LABEL: Record<string, string> = {
  selfverify: 'Self verify', context: 'Context', instructions: 'Agent rules', docs: 'Docs',
  'design-system': 'Design', memory: 'Memory', skills: 'Skills', evals: 'Evals', aiflow: 'AI flow',
  llmtracking: 'LLM tracking', datalinks: 'Data analysis',
};

/** One state, one Tone x Glyph, one name: everywhere. */
export const INK_MARK: Record<AtlasInk, { tone: Tone; glyph: Glyph; label: string }> = {
  bad: { tone: 'error', glyph: 'solid', label: 'Below readiness' },
  warn: { tone: 'warning', glyph: 'soft', label: 'Attention' },
  good: { tone: 'success', glyph: 'hollow', label: 'Healthy' },
  setup: { tone: 'info', glyph: 'empty', label: 'Set up' },
  info: { tone: 'neutral', glyph: 'soft', label: 'Information' },
  unknown: { tone: 'neutral', glyph: 'empty', label: 'Unknown' },
};

export const LEGEND_ORDER: AtlasInk[] = ['bad', 'warn', 'good', 'setup', 'info', 'unknown'];
