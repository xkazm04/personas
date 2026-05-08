import type { Translations } from '@/i18n/en';

/** Eight-dimension capability vocabulary used across adoption / edit / view surfaces. */
export const GLYPH_DIMENSIONS = [
  'trigger',
  'task',
  'connector',
  'message',
  'review',
  'memory',
  'event',
  'error',
] as const;
export type GlyphDimension = (typeof GLYPH_DIMENSIONS)[number];

export type GlyphPresence = 'linked' | 'shared' | 'none';

export interface GlyphTrigger {
  trigger_type: string;
  description?: string;
  config?: Record<string, unknown>;
}

export interface GlyphConnector {
  name: string;
  label?: string;
  purpose?: string;
  role?: string;
}

export interface GlyphStep {
  id: string;
  label: string;
  detail?: string;
  type?: string;
  connector?: string;
}

export interface GlyphEvent {
  event_type: string;
  description?: string;
}

/** Structural row contract for a single capability / use case. Any surface
 *  (adoption buildDraft, saved persona `last_design_result`, live edit state)
 *  can produce GlyphRow values and feed them to the shared UI. */
export interface GlyphRow {
  id: string;
  title: string;
  summary?: string;
  description?: string;
  enabled: boolean;
  triggers: GlyphTrigger[];
  connectors: GlyphConnector[];
  steps: GlyphStep[];
  events: GlyphEvent[];
  messageSummary?: string;
  reviewSummary?: string;
  memorySummary?: string;
  errorSummary?: string;
  presence: Record<GlyphDimension, GlyphPresence>;
  shared: boolean;
  /** Build-prompt Rule 28 — recommended runtime model for this capability.
   *  Surface as a small badge with `modelRationale` as the tooltip. Bare
   *  Claude model id (`"claude-sonnet-4-6"`, etc.) or null when the
   *  capability inherits the persona default. */
  recommendedModel?: string | null;
  /** One-sentence build-time explanation of the model pick. Empty / absent
   *  means "no rationale was emitted" — render the badge without a tooltip. */
  modelRationale?: string | null;
}

export interface DimMeta {
  labelKey: keyof Translations['templates']['chronology'];
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  colorClass: string;
  /** Optional bespoke SVG art component — wraps the lucide icon inside a
   *  decoration frame. Both layers use `currentColor` so the parent's
   *  `color` style drives the hue. The inner lucide is shown/hidden by
   *  `iconOpacity` (0..1) so the decoration stays as a structural marker
   *  even when the dim has no data yet (phase 2 reactivity). */
  customArt?: React.ComponentType<{ size: number; iconOpacity?: number }>;
}

export type DimMetaMap = Record<GlyphDimension, DimMeta>;

export interface ParsedChannel {
  type: string;
  description: string;
}
