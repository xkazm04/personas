import { CheckCircle2, AlertCircle, Clock, Loader2 } from 'lucide-react';

export const priorityConfig: Record<string, { color: string; bgColor: string; borderColor: string; label: string }> = {
  high: { color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30', label: 'High' },
  normal: { color: 'text-foreground', bgColor: 'bg-secondary/30', borderColor: 'border-primary/15', label: 'Normal' },
  low: { color: 'text-foreground', bgColor: 'bg-muted/20', borderColor: 'border-muted-foreground/20', label: 'Low' },
};

export type FilterType = 'all' | 'unread' | 'high';

export const FILTER_LABELS: Record<FilterType, string> = {
  all: 'All',
  unread: 'Unread',
  high: 'High Priority',
};

export const COLUMN_WIDTHS = {
  persona: '280px',
  priority: '180px',
  status: '120px',
  created: '140px',
} as const;

export const GRID_TEMPLATE_COLUMNS = `${COLUMN_WIDTHS.persona} minmax(0,2fr) ${COLUMN_WIDTHS.priority} ${COLUMN_WIDTHS.status} ${COLUMN_WIDTHS.created}`;

/** Row height for the flat message list. Matches the Activity list to keep
 *  the persona icon + body text comfortably aligned on a single row. */
export const MESSAGE_ROW_HEIGHT = 56;

export const deliveryStatusConfig: Record<string, { icon: typeof CheckCircle2; color: string; bgColor: string; borderColor: string; label: string }> = {
  delivered: { icon: CheckCircle2, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30', label: 'Delivered' },
  failed: { icon: AlertCircle, color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30', label: 'Failed' },
  pending: { icon: Clock, color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30', label: 'Pending' },
  queued: { icon: Loader2, color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30', label: 'Queued' },
};

export const channelLabels: Record<string, string> = {
  email: 'Email',
  slack: 'Slack',
  telegram: 'Telegram',
  desktop: 'Desktop',
};
