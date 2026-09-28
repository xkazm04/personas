/**
 * Status marks for the Cockpit's decision widgets (decisions panel, drawer, linked decisions):
 * kit Tone by what the severity MEANS and Glyph by the item's kind, so one inbox item wears the
 * same Mark in the list and in its drawer.
 */
import type { Glyph, Tone } from '@/features/shared/components/kit';
import type { Translations } from '@/i18n/generated/types';
import type { InboxKind, Severity, UnifiedInboxItem } from '@/features/companions/athena/inbox/types';

const SEVERITY_TONE: Record<Severity, Tone> = { critical: 'error', warning: 'warning', info: 'info' };

/** A decision to take is drawn solid, a message to read soft, a finished output hollow. */
const KIND_GLYPH: Record<InboxKind, Glyph> = { approval: 'solid', health: 'solid', message: 'soft', output: 'hollow' };

export function inboxKindLabel(kind: InboxKind, t: Translations): string {
  const c = t.overview.cockpit;
  switch (kind) {
    case 'approval': return c.decisions_kind_approval;
    case 'message': return c.decisions_kind_message;
    case 'output': return c.decisions_kind_output;
    case 'health': return c.decisions_kind_health;
  }
}

export function inboxMark(item: UnifiedInboxItem, t: Translations): { tone: Tone; glyph: Glyph; label: string } {
  return { tone: SEVERITY_TONE[item.severity] ?? 'neutral', glyph: KIND_GLYPH[item.kind], label: inboxKindLabel(item.kind, t) };
}

/** A manual review's free-form severity (critical/high/medium/low, or warning/info) as a kit Tone. */
export function reviewTone(severity: string | null | undefined): Tone {
  switch ((severity ?? '').toLowerCase()) {
    case 'critical':
    case 'high':
    case 'error':
      return 'error';
    case 'medium':
    case 'warning':
      return 'warning';
    case 'low':
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
}
