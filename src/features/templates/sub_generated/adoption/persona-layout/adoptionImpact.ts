// Shared impact-translation for the adoption sidebars.
//
// The baseline left panel shows raw state ("On" / "Off" / "1 event"). This
// translates each of the 8 dimensions into a plain-language IMPACT statement
// ("Memory activated", "Review on low confidence", "Reports to Slack + inbox")
// so the sidebar reads as a description of what the persona will actually do.
//
// Prototype note: copy here is English literal for fast iteration; it gets
// extracted to i18n (t.templates.adopt_modal.*) at consolidation if a variant
// using it wins.
import type { GlyphDimension } from '@/features/shared/glyph';

export type ImpactTone = 'active' | 'muted' | 'warn';

export interface DimImpact {
  dim: GlyphDimension;
  /** Short dimension label, e.g. "Memory", "When", "Delivers". */
  label: string;
  /** The plain-language impact, e.g. "Memory activated", "Daily at 9:00". */
  value: string;
  /** Optional second line of detail (answered values, channel list). */
  detail?: string;
  tone: ImpactTone;
}

/** Inputs the hook resolves for the active capability, then hands here. */
export interface ImpactInputs {
  /** Human schedule label from scheduleLabelFromSelection (null = manual). */
  scheduleLabel: string | null;
  /** Resolved Memory on/off for the active capability. */
  memoryOn: boolean;
  /** Whether the Memory dimension is relevant (template default or override). */
  memoryRelevant: boolean;
  /** Resolved Review on/off. */
  reviewOn: boolean;
  reviewRelevant: boolean;
  /** review_policy.mode for the active capability, if any. */
  reviewMode?: string | null;
  /** Count of cross-persona event subscriptions. */
  eventCount: number;
  /** Connector display labels attached to the active capability. */
  connectorLabels: string[];
  /** Messaging channel display labels (empty = no user-facing message). */
  channelLabels: string[];
  /** notificationChannels is non-null (user explicitly edited it). */
  channelsTouched: boolean;
  /** Error escalation policy for the active capability. */
  errorPolicy?: { incident?: boolean; lab?: boolean; escalate_after?: number };
  /** Answered free-text values per dimension (for the detail line). */
  answeredByDim: Partial<Record<GlyphDimension, string[]>>;
  /** Per-dimension short labels (i18n'd by the caller). */
  dimLabels: Record<GlyphDimension, string>;
}

function reviewImpact(on: boolean, mode?: string | null): string {
  if (!on) return 'Trusts the model — no review gate';
  switch ((mode ?? '').toLowerCase()) {
    case 'always':
      return 'Manual review required before acting';
    case 'auto_triage':
    case 'on_low_confidence':
    case 'on_uncertainty':
      return 'Review on low confidence';
    default:
      return 'Review activated';
  }
}

function errorImpact(p?: ImpactInputs['errorPolicy']): string {
  if (!p) return 'Logs failures';
  const targets: string[] = [];
  if (p.incident) targets.push('Incidents');
  if (p.lab) targets.push('Lab');
  if (targets.length === 0) return 'Logs failures';
  const after = p.escalate_after && p.escalate_after > 1 ? ` after ${p.escalate_after} fails` : '';
  return `Escalates to ${targets.join(' + ')}${after}`;
}

function joinList(items: string[], max = 2): string {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} +${items.length - max} more`;
}

/**
 * Build impact statements for all 8 dimensions in display order. Only the
 * dimensions with a meaningful state get a non-muted tone; the rest read as
 * a quiet "not set" so the panel still shows the full shape of the persona.
 */
export function buildDimImpacts(inp: ImpactInputs): DimImpact[] {
  const L = inp.dimLabels;
  const ans = inp.answeredByDim;
  const detail = (dim: GlyphDimension) => {
    const v = ans[dim];
    return v && v.length ? joinList(v, 3) : undefined;
  };

  const trigger: DimImpact = inp.scheduleLabel
    ? { dim: 'trigger', label: L.trigger, value: inp.scheduleLabel, tone: 'active' }
    : { dim: 'trigger', label: L.trigger, value: 'Runs on demand', tone: 'muted' };

  const task: DimImpact = {
    dim: 'task',
    label: L.task,
    value: detail('task') ? 'Configured' : 'Default behavior',
    detail: detail('task'),
    tone: detail('task') ? 'active' : 'muted',
  };

  const connector: DimImpact = inp.connectorLabels.length
    ? { dim: 'connector', label: L.connector, value: `Connected to ${joinList(inp.connectorLabels)}`, detail: detail('connector'), tone: 'active' }
    : { dim: 'connector', label: L.connector, value: 'No apps connected', tone: 'muted' };

  const message: DimImpact = inp.channelLabels.length
    ? { dim: 'message', label: L.message, value: `Reports to ${joinList(inp.channelLabels)}`, tone: 'active' }
    : inp.channelsTouched
      ? { dim: 'message', label: L.message, value: 'No message output', tone: 'warn' }
      : { dim: 'message', label: L.message, value: 'Delivers to your inbox', tone: 'muted' };

  const review: DimImpact = inp.reviewRelevant
    ? { dim: 'review', label: L.review, value: reviewImpact(inp.reviewOn, inp.reviewMode), detail: detail('review'), tone: inp.reviewOn ? 'active' : 'muted' }
    : { dim: 'review', label: L.review, value: 'Trusts the model', tone: 'muted' };

  const memory: DimImpact = inp.memoryRelevant
    ? { dim: 'memory', label: L.memory, value: inp.memoryOn ? 'Memory activated — learns across runs' : 'Memory off', detail: detail('memory'), tone: inp.memoryOn ? 'active' : 'muted' }
    : { dim: 'memory', label: L.memory, value: 'Memory off', tone: 'muted' };

  const event: DimImpact = inp.eventCount > 0
    ? { dim: 'event', label: L.event, value: `Listens to ${inp.eventCount} event${inp.eventCount === 1 ? '' : 's'}`, tone: 'active' }
    : { dim: 'event', label: L.event, value: 'No event triggers', tone: 'muted' };

  const error: DimImpact = { dim: 'error', label: L.error, value: errorImpact(inp.errorPolicy), tone: 'active' };

  // Display order = the persona's story: when → what → connects → delivers →
  // guards (review/memory/events/errors).
  return [trigger, task, connector, message, review, memory, event, error];
}
