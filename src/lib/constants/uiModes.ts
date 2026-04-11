/**
 * Centralised UI enum constants.
 *
 * Use the `as const` objects for runtime values (switch/match, comparisons)
 * and the derived union types for type annotations. This gives consumers
 * autocomplete, exhaustiveness checking, and single-source refactor safety.
 */
import { en, type Translations } from '@/i18n/en';

// ---------------------------------------------------------------------------
// Tiered feature gate system
// ---------------------------------------------------------------------------
//
// Three audience tiers control feature visibility at both compile-time and
// runtime. Each tier is a strict superset of the previous one:
//
//   starter (1)  → clean UI for non-technical users
//   team    (2)  → + pipelines, templates, deployment, analytics
//   builder (3)  → + dev tools, lab, design system, raw JSON
//
// Runtime: users can switch tiers via Settings → Account.
// Compile-time: set APP_TIER env var to tree-shake higher-tier code entirely.

export const TIERS = {
  STARTER: 'starter',
  TEAM: 'team',
  BUILDER: 'builder',
} as const;

export type Tier = (typeof TIERS)[keyof typeof TIERS];

/** Numeric rank for comparison: is the user's tier >= a feature's minTier? */
export const TIER_RANK: Record<Tier, number> = {
  [TIERS.STARTER]: 1,
  [TIERS.TEAM]: 2,
  [TIERS.BUILDER]: 3,
};

/** Maximum tier allowed by this build. Set via APP_TIER env var at build time. */
export const BUILD_MAX_TIER: Tier =
  (import.meta.env.VITE_APP_TIER as Tier | undefined) ?? TIERS.BUILDER;

/** Whether a given tier is available in this build. */
export function isTierAvailable(tier: Tier): boolean {
  return TIER_RANK[tier] <= TIER_RANK[BUILD_MAX_TIER];
}

/** Whether a feature at `minTier` is visible for the given `activeTier`. */
export function isTierVisible(minTier: Tier, activeTier: Tier): boolean {
  return TIER_RANK[activeTier] >= TIER_RANK[minTier];
}

/** Ordered cycle for toggling — runtime UI only exposes starter/team.
 *  Builder features use compile-time `devOnly` gating, not the runtime tier. */
export const TIER_CYCLE: readonly Tier[] =
  ([TIERS.STARTER, TIERS.TEAM] as const).filter(isTierAvailable);

/** Default tier for fresh installs. */
export const DEFAULT_TIER: Tier = TIERS.TEAM;

/**
 * Human-readable labels for the runtime-visible tiers.
 * Hardcoded strings are fallbacks — prefer i18n keys via `getTierLabel()` below.
 */
export const TIER_LABELS: Partial<Record<Tier, { label: string; desc: string }>> = {
  [TIERS.STARTER]: { label: 'Simple', desc: 'Core features for everyday use' },
  [TIERS.TEAM]:    { label: 'Power',  desc: 'Full feature set' },
};

/** i18n key map for tier labels. Use with `t.tiers[key]` in components. */
export const TIER_I18N_KEYS: Partial<Record<Tier, { label: string; desc: string }>> = {
  [TIERS.STARTER]: { label: 'tiers.starter_label', desc: 'tiers.starter_desc' },
  [TIERS.TEAM]:    { label: 'tiers.team_label',    desc: 'tiers.team_desc' },
};

/** Resolve tier labels from the given translation bundle. Defaults to English. */
export function getTierLabels(t: Translations = en): Partial<Record<Tier, { label: string; desc: string }>> {
  return {
    [TIERS.STARTER]: {
      label: t.tiers.starter_label ?? TIER_LABELS[TIERS.STARTER]?.label ?? 'Simple',
      desc: t.tiers.starter_desc ?? TIER_LABELS[TIERS.STARTER]?.desc ?? '',
    },
    [TIERS.TEAM]: {
      label: t.tiers.team_label ?? TIER_LABELS[TIERS.TEAM]?.label ?? 'Power',
      desc: t.tiers.team_desc ?? TIER_LABELS[TIERS.TEAM]?.desc ?? '',
    },
  };
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases (VIEW_MODES → TIERS mapping)
// ---------------------------------------------------------------------------

/** @deprecated Use TIERS instead */
export const VIEW_MODES = {
  SIMPLE: TIERS.STARTER,
  FULL: TIERS.TEAM,
  DEV: TIERS.BUILDER,
} as const;

/** @deprecated Use Tier instead */
export type ViewMode = Tier;

/** @deprecated Use TIER_CYCLE instead */
export const VIEW_MODE_CYCLE = TIER_CYCLE;

/** @deprecated Use DEFAULT_TIER instead */
export const DEFAULT_VIEW_MODE = DEFAULT_TIER;

// ---------------------------------------------------------------------------
// Component-level view modes
// ---------------------------------------------------------------------------

/** Healing issues panel */
export const HEALING_VIEW_MODES = {
  LIST: 'list',
  TIMELINE: 'timeline',
} as const;

export type HealingViewMode = (typeof HEALING_VIEW_MODES)[keyof typeof HEALING_VIEW_MODES];

/** Schedule timeline */
export const SCHEDULE_VIEW_MODES = {
  TIMELINE: 'timeline',
  GROUPED: 'grouped',
  CALENDAR: 'calendar',
} as const;

export type ScheduleViewMode = (typeof SCHEDULE_VIEW_MODES)[keyof typeof SCHEDULE_VIEW_MODES];

/** Team memory panel */
export const TEAM_MEMORY_VIEW_MODES = {
  LIST: 'list',
  TIMELINE: 'timeline',
  DIFF: 'diff',
} as const;

export type TeamMemoryViewMode = (typeof TEAM_MEMORY_VIEW_MODES)[keyof typeof TEAM_MEMORY_VIEW_MODES];

/** Template gallery */
export const TEMPLATE_VIEW_MODES = {
  LIST: 'list',
  EXPLORE: 'explore',
} as const;

export type TemplateViewMode = (typeof TEMPLATE_VIEW_MODES)[keyof typeof TEMPLATE_VIEW_MODES];

/** Tool selector */
export const TOOL_VIEW_MODES = {
  GRID: 'grid',
  GROUPED: 'grouped',
} as const;

export type ToolViewMode = (typeof TOOL_VIEW_MODES)[keyof typeof TOOL_VIEW_MODES];

/** Persona connectors tab */
export const CONNECTOR_VIEW_MODES = {
  LIST: 'list',
  GRAPH: 'graph',
} as const;

export type ConnectorViewMode = (typeof CONNECTOR_VIEW_MODES)[keyof typeof CONNECTOR_VIEW_MODES];
