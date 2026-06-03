import { CheckCircle2, AlertCircle, Clock, Loader2, ChevronDown } from 'lucide-react';

/** Visual treatment for a message priority chip. The three tiers are deliberately
 *  separable at a glance: High stays a solid red alert chip, Normal is a quiet but
 *  present neutral chip, and Low is a recessive "ghost" — dashed border, muted
 *  text, and a down-chevron so it reads as low even before color registers. */
export interface PriorityStyle {
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  /** Optional leading glyph. Low gets a down-chevron so the recessive tier is
   *  scannable by shape, not color alone (also helps color-vision-deficient users). */
  icon?: typeof ChevronDown;
  /** Extra chip classes (e.g. `border-dashed`, opacity) layered after the color tokens. */
  chipClass?: string;
}

export const priorityConfig: Record<string, PriorityStyle> = {
  high: { color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30', label: 'High' },
  normal: { color: 'text-foreground/90', bgColor: 'bg-secondary/40', borderColor: 'border-primary/20', label: 'Normal' },
  low: { color: 'text-muted-foreground/70', bgColor: 'bg-transparent', borderColor: 'border-muted-foreground/25', label: 'Low', icon: ChevronDown, chipClass: 'border-dashed' },
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
  delivered: { icon: CheckCircle2, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30', ring: 'ring-emerald-400/45', label: 'Delivered' },
  failed: { icon: AlertCircle, color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30', ring: 'ring-red-400/45', label: 'Failed' },
  pending: { icon: Clock, color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30', ring: 'ring-amber-400/45', label: 'Pending' },
  queued: { icon: Loader2, color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30', ring: 'ring-blue-400/45', label: 'Queued' },
};

export const channelLabels: Record<string, string> = {
  email: 'Email',
  slack: 'Slack',
  telegram: 'Telegram',
  desktop: 'Desktop',
};
