// THE TYPE ROLES of the Lifecycle module: the only place a Lifecycle component
// picks a `typo-*` token. Modelled on `teams/sub_kpis/estate/kpiType.ts`.
//
// Before this file (audit 2026-10-08) `typo-data-lg` was six things at once:
// the 176px ring's hero figure, a satellite, the 112px arc figure, the tally,
// the goal count and an "N/A" word. A reader could not tell which number a
// screen led with, because they were all the same size. Each role here is ONE
// thing, and a screen has at most one `hero`.
//
// Rules this file keeps:
//
// - Nothing puts `text-foreground` beside a token: the body colour is already
//   foreground, so the class said nothing and hid real overrides in noise.
//   A colour beside a token is a MEANING (a status ink, the primary accent).
// - No `font-*` patches beside a token (census `typo-token-overpainted`).
//   Segoe UI has 400 / 600 / 700 only; every role lands on one of them.
// - The tinted title tokens (`typo-title`, `typo-section-title`) are not used
//   for step names: a selected step changes its colour, never its token, so
//   selecting a step does not reflow the rail.

export const LT = {
  /** A screen's own title: the step's name on its Layer-2 screen. */
  pageTitle: 'typo-heading-lg',
  /** The name of a thing: a step on the rail, a card head, a group head. */
  title: 'typo-heading',
  /** The ONE figure a screen leads with: the Layer-2 instrument. */
  hero: 'typo-hero tabular-nums',
  /** A measured figure that is not the lead: a collar, a satellite, a preset's figure, the goal. */
  stat: 'typo-data-lg',
  /** A sentence that leads a block: the headline, a step's reason, its rule. */
  lead: 'typo-body-lg',
  /** A sentence or value in a row. */
  row: 'typo-body',
  /** A number in a row: the row's size, tabular so a column aligns. */
  rowNum: 'typo-data',
  /** A short label: a metric's name, a pill, a column head. Never a sentence. */
  label: 'typo-label',
  /** A change against the earlier measure, beside its figure ("+6 pts"); toned good or bad by its caller. */
  delta: 'typo-label tabular-nums',
  /** Everything secondary: a context line, a hint, a unit. The one muting. */
  meta: 'typo-caption',
  /** A secondary figure (n = 12, a denominator). */
  metaNum: 'typo-caption tabular-nums',
  /** A section head inside a surface, always in the one accent. */
  eyebrow: 'typo-eyebrow text-primary',
  /** A command line, a path, a sha. */
  code: 'typo-code',
} as const;

export type TypeRole = keyof typeof LT;
