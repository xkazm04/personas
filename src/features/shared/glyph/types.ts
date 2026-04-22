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
}

export interface DimMeta {
  labelKey: keyof Translations['templates']['chronology'];
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  colorClass: string;
}

export type DimMetaMap = Record<GlyphDimension, DimMeta>;

export interface ParsedChannel {
  type: string;
  description: string;
}
