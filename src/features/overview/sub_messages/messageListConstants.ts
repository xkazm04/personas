
// ---------------------------------------------------------------------------
// Priority config
// ---------------------------------------------------------------------------

export const priorityConfig: Record<string, { color: string; bgColor: string; borderColor: string; label: string }> = {
  high: { color: 'text-status-error', bgColor: 'bg-status-error/10', borderColor: 'border-status-error/30', label: 'High' },
  normal: { color: 'text-foreground/80', bgColor: 'bg-secondary/30', borderColor: 'border-primary/15', label: 'Normal' },
  low: { color: 'text-muted-foreground/90', bgColor: 'bg-muted/20', borderColor: 'border-muted-foreground/20', label: 'Low' },
};

export const defaultPriority = { color: 'text-foreground/80', bgColor: 'bg-secondary/30', borderColor: 'border-primary/15', label: 'Normal' };

export type FilterType = 'all' | 'unread' | 'high';

export const FILTER_LABELS: Record<FilterType, string> = {
  all: 'All',
  unread: 'Unread',
  high: 'High Priority',
};

export const COLUMN_WIDTHS = {
  persona: '180px',
  priority: '90px',
  status: '70px',
  created: '100px',
} as const;

export const GRID_TEMPLATE_COLUMNS = `${COLUMN_WIDTHS.persona} minmax(0,1fr) ${COLUMN_WIDTHS.priority} ${COLUMN_WIDTHS.status} ${COLUMN_WIDTHS.created}`;

// ---------------------------------------------------------------------------
// Delivery status config
// ---------------------------------------------------------------------------

// We store icon references as strings and resolve them at render time to avoid
// importing React components from a pure TS constants file.

export interface DeliveryStatusStyle {
  iconName: 'CheckCircle2' | 'AlertCircle' | 'Clock' | 'Loader2';
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
}

export const deliveryStatusConfig: Record<string, DeliveryStatusStyle> = {
  delivered: { iconName: 'CheckCircle2', color: 'text-status-success', bgColor: 'bg-status-success/10', borderColor: 'border-status-success/30', label: 'Delivered' },
  failed: { iconName: 'AlertCircle', color: 'text-status-error', bgColor: 'bg-status-error/10', borderColor: 'border-status-error/30', label: 'Failed' },
  pending: { iconName: 'Clock', color: 'text-status-pending', bgColor: 'bg-status-pending/10', borderColor: 'border-status-pending/30', label: 'Pending' },
  queued: { iconName: 'Loader2', color: 'text-status-processing', bgColor: 'bg-status-processing/10', borderColor: 'border-status-processing/30', label: 'Queued' },
};

export const channelLabels: Record<string, string> = {
  email: 'Email',
  slack: 'Slack',
  telegram: 'Telegram',
  desktop: 'Desktop',
};
