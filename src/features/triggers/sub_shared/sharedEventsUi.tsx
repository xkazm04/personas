import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ThemedConnectorIcon } from '@/lib/connectors/connectorMeta';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';
import type { SharedEventFeedActivity } from '@/lib/bindings/SharedEventFeedActivity';

/**
 * Shared presentational bits for the Marketplace table variants + history modal.
 * Extraction-friendly: FeedIcon and SeverityBadge are domain-agnostic enough to
 * hoist to a feature-level shared folder if a second surface needs them.
 */

/** Parsed shape of a firing/change payload (connector-API-update events). */
export interface ChangePayload {
  connector?: string;
  label?: string;
  docs_url?: string;
  detected_at?: string;
  summary?: string;
  tags?: string[];
  severity?: string;
  release_version?: string;
}

export function parseChangePayload(payload: string | null | undefined): ChangePayload {
  if (!payload) return {};
  try {
    const v = JSON.parse(payload) as unknown;
    return v && typeof v === 'object' ? (v as ChangePayload) : {};
  } catch {
    return {};
  }
}

/**
 * Renders a feed's icon. Connector feeds carry an SVG asset path (`/icons/...`);
 * other feeds may carry an emoji. Falls back to 📡.
 *
 * Uses the app's `ThemedConnectorIcon` (CSS-mask fill with a contrast-adjusted
 * brand color) so monochrome / black-stroke connector logos stay visible on the
 * dark theme instead of disappearing. The container carries a stronger brand
 * tint + border than a bare card so the icon reads at table scale.
 */
export function FeedIcon({
  entry,
  className = '',
  iconSize = 'w-5 h-5',
}: {
  entry: Pick<SharedEventCatalogEntry, 'icon' | 'color' | 'name'>;
  className?: string;
  /** Tailwind size for the inner glyph (should fit the container in `className`). */
  iconSize?: string;
}) {
  const icon = entry.icon;
  const color = entry.color ?? '#3b82f6';
  const isAsset = typeof icon === 'string' && icon.startsWith('/');
  return (
    <div
      className={`flex items-center justify-center rounded-card flex-shrink-0 border border-primary/15 ${className}`}
      style={{ backgroundColor: `${color}2e` }}
    >
      {isAsset ? (
        <ThemedConnectorIcon url={icon!} label={entry.name} color={color} size={iconSize} />
      ) : (
        <span className="typo-caption leading-none" aria-hidden>{!isAsset && icon ? icon : '📡'}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

type SeverityStyle = { dot: string; text: string; bg: string; border: string };

const MINOR_STYLE: SeverityStyle = {
  dot: 'bg-status-info', text: 'text-status-info', bg: 'bg-status-info/10', border: 'border-status-info/20',
};
const SEVERITY_STYLES: Record<string, SeverityStyle> = {
  patch: { dot: 'bg-foreground/40', text: 'text-foreground/70', bg: 'bg-secondary/40', border: 'border-primary/10' },
  minor: MINOR_STYLE,
  major: { dot: 'bg-status-warning', text: 'text-status-warning', bg: 'bg-status-warning/10', border: 'border-status-warning/25' },
  breaking: { dot: 'bg-status-error', text: 'text-status-error', bg: 'bg-status-error/10', border: 'border-status-error/25' },
};

export function severityStyle(severity: string | undefined): SeverityStyle {
  return SEVERITY_STYLES[severity ?? 'minor'] ?? MINOR_STYLE;
}

/** Ordinal for sorting: breaking > major > minor > patch. */
export function severityRank(severity: string | undefined): number {
  return { patch: 0, minor: 1, major: 2, breaking: 3 }[severity ?? 'minor'] ?? 1;
}

export function SeverityBadge({ severity, label }: { severity: string | undefined; label: string }) {
  const s = severityStyle(severity);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full typo-caption font-medium border ${s.bg} ${s.text} ${s.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {label}
    </span>
  );
}

export function severityLabel(t: Translations, severity: string | undefined): string {
  const m = t.triggers.marketplace;
  switch (severity) {
    case 'patch': return m.sev_patch;
    case 'major': return m.sev_major;
    case 'breaking': return m.sev_breaking;
    default: return m.sev_minor;
  }
}

/**
 * "Latest change" table cell: the newest change's severity + relative time, or a
 * muted "no changes yet" when the feed has no recorded firings.
 */
export function LastChangeCell({
  activity,
  showSummary = false,
}: {
  activity: SharedEventFeedActivity | undefined;
  showSummary?: boolean;
}) {
  const { t } = useTranslation();
  if (!activity) {
    return <span className="typo-caption text-foreground/40">{t.triggers.marketplace.no_last_change}</span>;
  }
  const p = parseChangePayload(activity.lastPayload);
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <SeverityBadge severity={p.severity} label={severityLabel(t, p.severity)} />
        <RelativeTime timestamp={activity.lastFiredAt} className="typo-caption text-foreground/60" />
      </div>
      {showSummary && p.summary && (
        <p className="typo-caption text-foreground/70 truncate">{p.summary}</p>
      )}
    </div>
  );
}
