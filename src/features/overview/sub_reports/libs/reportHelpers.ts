import { CheckCircle2, AlertCircle, AlertTriangle, Clock, Loader2, ChevronDown } from 'lucide-react';

/** Visual treatment for a message priority chip. The tiers are deliberately
 *  separable at a glance: Critical is the loudest (status-error ink, a stronger
 *  fill and a warning glyph, so it outranks High by shape too), High stays a solid red alert chip, Normal is a quiet but
 *  present neutral chip, and Low is a recessive "ghost" — dashed border, muted
 *  text, and a down-chevron so it reads as low even before color registers. */
export interface PriorityStyle {
  color: string;
  bgColor: string;
  borderColor: string;
  /** English fallback name; absent where every render site passes a translated one. */
  label?: string;
  /** Optional leading glyph. Low gets a down-chevron so the recessive tier is
   *  scannable by shape, not color alone (also helps color-vision-deficient users). */
  icon?: typeof ChevronDown | typeof AlertTriangle;
  /** Extra chip classes (e.g. `border-dashed`, opacity) layered after the color tokens. */
  chipClass?: string;
}

export const priorityConfig: Record<string, PriorityStyle> = {
  // The engine writes `critical` (engine/execution.rs) and this map had no
  // entry for it, so a critical report rendered as Normal.
  // No English label: every render site passes the translated tier name
  // (`overview.reader_priority_critical`).
  critical: { color: 'text-status-error', bgColor: 'bg-status-error/15', borderColor: 'border-status-error/50', icon: AlertTriangle },
  high: { color: 'text-status-warning', bgColor: 'bg-status-warning/10', borderColor: 'border-status-warning/30', label: 'High' },
  normal: { color: 'text-ink-2', bgColor: 'bg-surface-1', borderColor: 'border-hair', label: 'Normal' },
  low: { color: 'text-ink-3', bgColor: 'bg-transparent', borderColor: 'border-hair', label: 'Low', icon: ChevronDown, chipClass: 'border-dashed' },
};

/** A report's body format, from its `content_type`. Only `html` is a document
 *  frame; every other type (text, markdown, code, alert, ...) is markdown. */
export function reportFormat(contentType: string | null | undefined): 'markdown' | 'html' {
  return contentType === 'html' ? 'html' : 'markdown';
}

/** Row height for the flat message list. Matches the Activity list to keep
 *  the persona icon + body text comfortably aligned on a single row. */
export const MESSAGE_ROW_HEIGHT = 56;

export interface DeliveryStatusStyle {
  icon: typeof CheckCircle2;
  /** Text/icon tint for the status label. */
  color: string;
  bgColor: string;
  borderColor: string;
  /** Ring color for the channel-icon medallion — makes success/failure scannable at a glance. */
  ring: string;
  label: string;
}

export const deliveryStatusConfig: Record<string, DeliveryStatusStyle> = {
  delivered: { icon: CheckCircle2, color: 'text-status-success', bgColor: 'bg-status-success/10', borderColor: 'border-status-success/30', ring: 'ring-status-success/45', label: 'Delivered' },
  failed: { icon: AlertCircle, color: 'text-status-error', bgColor: 'bg-status-error/10', borderColor: 'border-status-error/30', ring: 'ring-status-error/45', label: 'Failed' },
  pending: { icon: Clock, color: 'text-status-warning', bgColor: 'bg-status-warning/10', borderColor: 'border-status-warning/30', ring: 'ring-status-warning/45', label: 'Pending' },
  queued: { icon: Loader2, color: 'text-status-info', bgColor: 'bg-status-info/10', borderColor: 'border-status-info/30', ring: 'ring-status-info/45', label: 'Queued' },
};

export const channelLabels: Record<string, string> = {
  email: 'Email',
  slack: 'Slack',
  telegram: 'Telegram',
  desktop: 'Desktop',
};
