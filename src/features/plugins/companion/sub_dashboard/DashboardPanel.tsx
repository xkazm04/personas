import { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import {
  companionGetDashboard,
  type CompanionDashboardSpec,
  type CompanionDashboardSpecBody,
  type CompanionDashboardWidget,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { widgetRegistry } from './widgetRegistry';

/**
 * Phase F: Athena's dashboard playground.
 *
 * The spec is composed by Athena via `compose_dashboard` and persisted
 * server-side as a singleton. This panel reads the latest spec on
 * mount, parses it, and renders each widget in a CSS-grid layout
 * (`span` is a 1-12 column hint per widget).
 *
 * If no spec exists yet, we show a simple empty state pointing the
 * user at the chat — Athena's the one who composes here.
 */
export default function DashboardPanel() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [spec, setSpec] = useState<CompanionDashboardSpec | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    companionGetDashboard()
      .then((s) => {
        setSpec(s);
        setLoading(false);
      })
      .catch((err: unknown) => {
        silentCatch('companion_get_dashboard')(err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
    // Re-load when the user re-enters the tab — cheap, ensures the
    // panel reflects the latest compose_dashboard from chat.
    const handler = () => load();
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!spec) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-foreground/60 gap-3">
        <LayoutDashboard className="w-8 h-8 text-foreground/30" />
        <div className="typo-body font-medium">{t.plugins.companion.dashboard_empty_title}</div>
        <div className="typo-caption text-foreground/50 max-w-md text-center">
          {t.plugins.companion.dashboard_empty_body}
        </div>
      </div>
    );
  }

  let body: CompanionDashboardSpecBody | null = null;
  try {
    body = JSON.parse(spec.specJson) as CompanionDashboardSpecBody;
  } catch {
    // Invalid saved specs render as an empty dashboard below.
  }
  const widgets = body?.widgets ?? [];

  return (
    <div className="space-y-3">
      {body?.title && (
        <div className="flex items-center justify-between">
          <h2 className="typo-h3 font-semibold text-foreground">{body.title}</h2>
          <div className="typo-caption text-foreground/40">
            {t.plugins.companion.dashboard_updated_at.replace(
              '{{when}}',
              formatRelative(spec.updatedAt),
            )}
          </div>
        </div>
      )}
      <div className="grid grid-cols-12 gap-3 auto-rows-[180px]">
        {widgets.map((w) => (
          <DashboardWidget key={w.id} widget={w} />
        ))}
      </div>
    </div>
  );
}

function DashboardWidget({ widget }: { widget: CompanionDashboardWidget }) {
  const { t } = useTranslation();
  const span = Math.max(1, Math.min(12, widget.span ?? 6));
  // Charts deserve more height than KPI tiles. Heuristic on kind:
  //   - 1 row: compact KPIs and gauges (read at a glance, no scroll)
  //   - 2 rows: most charts and lists (need vertical room for axis/labels)
  //   - 3 rows: tabular data (rows + headers benefit from extra height)
  let rowSpan = 2;
  if (widget.kind === 'kpi_tile' || widget.kind === 'success_rate_gauge') {
    rowSpan = 1;
  } else if (widget.kind === 'recent_executions_table') {
    rowSpan = 3;
  }
  const Component = widgetRegistry[widget.kind as keyof typeof widgetRegistry];
  return (
    <div
      style={{ gridColumn: `span ${span} / span ${span}`, gridRow: `span ${rowSpan} / span ${rowSpan}` }}
      className="min-h-0"
    >
      {Component ? (
        <Component title={widget.title} config={widget.config} />
      ) : (
        <div className="rounded-card border border-rose-500/30 bg-rose-500/[0.06] p-4 typo-caption text-rose-300 h-full flex items-center justify-center">
          {t.plugins.companion.dashboard_unknown_widget}: {widget.kind}
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const sec = (Date.now() - t) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
