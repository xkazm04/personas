// The specimen's content: the token inventory on both sides, the phantom map,
// and real sample copy (names, sentences and figures of the kind the app
// shows), so the operator judges type on text he recognises.

export const SAMPLE = {
  agent: 'Invoice Reconciler',
  sentence: 'Matches incoming invoices against open purchase orders and flags the ones that disagree.',
  metric: '1,284',
  label: 'Last 7 days',
  code: 'persona_7f3a2c',
  greeting: 'Good morning, Alex',
  page: 'Agents',
  section: 'Connectors',
  eyebrow: 'Suggested actions',
};

/** One row per type role: what the app writes today, and what it becomes. */
export interface TypeRow {
  token: string;
  sample: string;
  /** The class string written today, and what the token was documented for. */
  current: { cls: string; role: string };
  /** The proposed class string and its role (a role, not a value). */
  proposed: { cls: string; role: string; retiresInto?: string; isNew?: boolean };
}

export const TYPE_ROWS: TypeRow[] = [
  { token: 'typo-hero', sample: SAMPLE.greeting,
    current: { cls: 'typo-hero', role: 'Page greeting' },
    proposed: { cls: 'typo-hero', role: 'The one greeting a page opens with' } },
  { token: 'typo-heading-lg', sample: SAMPLE.page,
    current: { cls: 'typo-heading-lg', role: 'Page-level heading' },
    proposed: { cls: 'typo-heading-lg', role: 'The title of a page or a modal' } },
  { token: 'typo-submodule-header', sample: SAMPLE.section,
    current: { cls: 'typo-submodule-header', role: 'Agent submodule divider, primary-tinted' },
    proposed: { cls: 'typo-submodule-header', role: 'Retired', retiresInto: 'typo-section-title' } },
  { token: 'typo-section-title', sample: SAMPLE.section,
    current: { cls: 'typo-section-title', role: 'Section divider, primary-tinted in dark themes' },
    proposed: { cls: 'typo-section-title', role: 'Divides a page into parts; one step larger, no tint' } },
  { token: 'typo-title-lg', sample: SAMPLE.agent,
    current: { cls: 'typo-title-lg', role: 'Content headline, primary-tinted' },
    proposed: { cls: 'typo-title-lg', role: 'The name of the one thing a card is about' } },
  { token: 'typo-body-lg', sample: SAMPLE.sentence,
    current: { cls: 'typo-body-lg', role: 'Prominent description' },
    proposed: { cls: 'typo-body-lg', role: 'Lead prose that opens a surface' } },
  { token: 'typo-heading', sample: 'Recent runs',
    current: { cls: 'typo-heading', role: 'Section title, card header' },
    proposed: { cls: 'typo-heading', role: 'Heads a card or panel; body size, set apart by weight' } },
  { token: 'typo-title', sample: SAMPLE.agent,
    current: { cls: 'typo-title', role: 'Form label, list-item headline, primary-tinted' },
    proposed: { cls: 'typo-title', role: 'The name of a thing in a row or a field' } },
  { token: 'typo-card-label', sample: SAMPLE.agent,
    current: { cls: 'typo-card-label', role: 'Card-grid label with a primary glow' },
    proposed: { cls: 'typo-card-label', role: 'Retired', retiresInto: 'typo-title' } },
  { token: 'typo-body', sample: SAMPLE.sentence,
    current: { cls: 'typo-body', role: 'Paragraph, description' },
    proposed: { cls: 'typo-body', role: 'A sentence a user reads' } },
  { token: 'typo-caption', sample: SAMPLE.sentence,
    current: { cls: 'typo-caption', role: 'Secondary text, 70% foreground' },
    proposed: { cls: 'typo-caption', role: 'Everything secondary: the one muting' } },
  { token: 'typo-data', sample: `${SAMPLE.metric} runs`,
    current: { cls: 'typo-data', role: 'Number, metric' },
    proposed: { cls: 'typo-data', role: 'A figure in a row, tabular' } },
  { token: 'typo-data-lg', sample: SAMPLE.metric,
    current: { cls: 'typo-data-lg', role: 'Hero metric' },
    proposed: { cls: 'typo-data-lg', role: 'The one figure a surface leads with' } },
  { token: 'typo-label', sample: SAMPLE.label,
    current: { cls: 'typo-label', role: 'Badge, chip, column header' },
    proposed: { cls: 'typo-label', role: 'Names a thing in less than a line' } },
  { token: 'typo-eyebrow', sample: SAMPLE.eyebrow,
    current: { cls: 'typo-heading uppercase tracking-wider', role: 'No token: KT.eyebrow / ContentEyebrow compose it (tracking-wider is dead)' },
    proposed: { cls: 'typo-eyebrow', role: 'Tracked uppercase head inside a surface', isNew: true } },
  { token: 'typo-code', sample: SAMPLE.code,
    current: { cls: 'typo-code', role: 'Monospace id, technical value' },
    proposed: { cls: 'typo-code', role: 'An identifier or value to copy' } },
];

/** The phantom names: written at call sites, defined nowhere. Counts come
 *  from measure.generated.json at render time. */
export const PHANTOM_MAP: { cls: string; to: string; why: string }[] = [
  { cls: 'typo-body-sm', to: 'typo-body', why: 'there is no small body; nothing small' },
  { cls: 'typo-overline', to: 'typo-eyebrow', why: 'the tracked uppercase head it imitates' },
  { cls: 'typo-heading-sm', to: 'typo-heading', why: 'card and modal heads' },
  { cls: 'typo-body-strong', to: 'typo-title', why: 'body size at 600 is the name role' },
  { cls: 'typo-heading-md', to: 'typo-title-lg', why: 'modal titles one step above a row' },
  { cls: 'typo-button', to: 'typo-title', why: 'and the three raw buttons become <Button>' },
  { cls: 'typo-h3', to: 'typo-heading-lg', why: 'panel titles (also 3 inert [&_h1]: uses)' },
  { cls: 'typo-title-sm', to: 'typo-title', why: 'one size for a name' },
  { cls: 'typo-heading-xs', to: 'typo-title', why: 'an editable row head' },
  { cls: 'typo-display', to: 'typo-data-lg', why: 'a lead metric' },
  { cls: 'typo-data-md', to: 'typo-data', why: 'a figure in a row' },
];

export const THEMES = [
  'dark-midnight', 'dark-cyan', 'dark-bronze', 'dark-frost', 'dark-purple', 'dark-pink',
  'dark-red', 'dark-matrix', 'light', 'light-ice', 'light-news',
] as const;
export type ThemeName = (typeof THEMES)[number];

/** The app's three user-facing text scales (themeStore TEXT_SCALES):
 *  label -> data-text-scale value. "Standard" is the product default. */
export const TEXT_SCALES = [
  { id: 'large', label: 'Small' },
  { id: 'larger', label: 'Standard (default)' },
  { id: 'xl', label: 'Large' },
] as const;
export type TextScaleId = (typeof TEXT_SCALES)[number]['id'];

export const ROLES = [
  { id: 'agent', meaning: 'An agent made, proposed or is doing this', replaces: 'violet, purple, fuchsia, indigo; accentColor violet/purple/indigo' },
  { id: 'human', meaning: 'You made this, or it is waiting on you', replaces: 'pink; the Manifest "you" tone; review-waiting markers' },
  { id: 'external', meaning: 'Something outside the app: connector, service, webhook', replaces: 'cyan, sky, teal used on connector / cloud / API marks' },
  { id: 'highlight', meaning: 'Look here, with no further meaning', replaces: 'accentColor cyan/blue as a generic accent; ContentTone primary/blue' },
] as const;

export const STATUSES = ['success', 'warning', 'error', 'info'] as const;
