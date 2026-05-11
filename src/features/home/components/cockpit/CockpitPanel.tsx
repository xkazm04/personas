import { useCallback, useEffect, useState } from 'react';
import { Compass } from 'lucide-react';

import {
  companionGetCockpit,
  type CompanionCockpitSpec,
  type CompanionCockpitSpecBody,
  type CompanionCockpitWidget,
} from '@/api/companion';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { silentCatch } from '@/lib/silentCatch';

import { cockpitWidgetRegistry } from './widgetRegistry';

/**
 * Home → Cockpit. The spec is composed by Athena via `compose_cockpit` and
 * persisted server-side as a singleton. This panel reads the latest spec on
 * mount + on window focus, parses it, and renders each widget in a 12-col
 * grid (mirrors DashboardPanel).
 *
 * If no spec exists yet, we show an empty-state CTA pointing the user at
 * the chat — Athena's the one who composes here.
 */
export default function CockpitPanel() {
  const [loading, setLoading] = useState(true);
  const [spec, setSpec] = useState<CompanionCockpitSpec | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    companionGetCockpit()
      .then((s) => {
        setSpec(s);
        setLoading(false);
      })
      .catch((err: unknown) => {
        silentCatch('companion_get_cockpit')(err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
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
        <Compass className="w-8 h-8 text-foreground/30" />
        <div className="typo-body font-medium">Your cockpit is empty</div>
        <div className="typo-caption text-foreground/50 max-w-md text-center">
          Ask Athena to compose a cockpit view — try
          <span className="text-foreground/75"> "show me my personas" </span>
          or <span className="text-foreground/75">"what needs my attention"</span>.
        </div>
      </div>
    );
  }

  let body: CompanionCockpitSpecBody | null = null;
  try {
    body = JSON.parse(spec.specJson) as CompanionCockpitSpecBody;
  } catch {
    // Invalid saved specs render as an empty cockpit below.
  }
  const widgets = body?.widgets ?? [];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
      {body?.title && (
        <div className="flex items-center justify-between">
          <h2 className="typo-h3 font-semibold text-foreground">{body.title}</h2>
          <div className="typo-caption text-foreground/40">
            updated {formatRelative(spec.updatedAt)}
          </div>
        </div>
      )}
      <div className="grid grid-cols-12 gap-3 auto-rows-[180px]">
        {widgets.map((w) => (
          <CockpitWidgetCell key={w.id} widget={w} />
        ))}
      </div>
    </div>
  );
}

function CockpitWidgetCell({ widget }: { widget: CompanionCockpitWidget }) {
  const span = Math.max(1, Math.min(12, widget.span ?? 6));
  // Heights tuned per kind: persona grid and decisions list want vertical
  // room; connected services is denser and reads well at 2 rows.
  let rowSpan = 2;
  if (widget.kind === 'persona_overview' || widget.kind === 'decisions_panel') {
    rowSpan = 3;
  }
  const Component = cockpitWidgetRegistry[widget.kind];
  return (
    <div
      style={{
        gridColumn: `span ${span} / span ${span}`,
        gridRow: `span ${rowSpan} / span ${rowSpan}`,
      }}
      className="min-h-0"
    >
      {Component ? (
        <Component title={widget.title} config={widget.config} />
      ) : (
        <div className="rounded-card border border-rose-500/30 bg-rose-500/[0.06] p-4 typo-caption text-rose-300 h-full flex items-center justify-center">
          Unknown widget: {widget.kind}
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
