import { useCallback, useEffect, useState } from 'react';
import { Compass, MessageCircle } from 'lucide-react';

import {
  companionGetCockpit,
  type CompanionCockpitSpec,
  type CompanionCockpitSpecBody,
  type CompanionCockpitWidget,
} from '@/api/companion';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import {
  ContentBody,
  ContentBox,
  ContentHeader,
} from '@/features/shared/components/layout/ContentLayout';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { silentCatch } from '@/lib/silentCatch';

import { cockpitWidgetRegistry } from './widgetRegistry';

/**
 * Home → Cockpit. The spec is composed by Athena via `compose_cockpit` and
 * persisted server-side as a singleton. This panel reads the latest spec on
 * mount + on window focus, parses it, and renders each widget in a 12-col
 * grid.
 *
 * If no spec exists yet, the empty state CTAs the user to chat — Athena's
 * the one who composes here. The header includes a "Talk to Athena" action
 * that opens the companion chat panel so the user can ask for a cockpit
 * composition (or any other request) without hunting for the footer icon.
 */
export default function CockpitPanel() {
  const [loading, setLoading] = useState(true);
  const [spec, setSpec] = useState<CompanionCockpitSpec | null>(null);
  const setCompanionState = useCompanionStore((s) => s.setState);

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

  let body: CompanionCockpitSpecBody | null = null;
  if (spec) {
    try {
      body = JSON.parse(spec.specJson) as CompanionCockpitSpecBody;
    } catch {
      // Invalid saved specs render as an empty cockpit below.
    }
  }
  const widgets = body?.widgets ?? [];
  const headerTitle = body?.title ?? 'Cockpit';
  const headerSubtitle = spec
    ? `Composed by Athena — updated ${formatRelative(spec.updatedAt)}`
    : 'Your companion-driven workspace';

  const talkToAthena = (
    <button
      type="button"
      onClick={() => setCompanionState('open')}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-input typo-caption font-medium bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/30 transition-colors"
      data-testid="cockpit-talk-to-athena"
    >
      <MessageCircle className="w-3.5 h-3.5" />
      Talk to Athena
    </button>
  );

  return (
    <ContentBox data-testid="cockpit-panel">
      <ContentHeader
        icon={<Compass className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={headerTitle}
        subtitle={headerSubtitle}
        actions={talkToAthena}
      />
      <ContentBody centered>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <LoadingSpinner size="lg" />
          </div>
        ) : !spec ? (
          <CockpitEmptyState onTalk={() => setCompanionState('open')} />
        ) : (
          <div className="grid grid-cols-12 gap-3 auto-rows-[180px]">
            {widgets.map((w) => (
              <CockpitWidgetCell key={w.id} widget={w} />
            ))}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}

function CockpitEmptyState({ onTalk }: { onTalk: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-foreground/60 gap-4">
      <Compass className="w-10 h-10 text-foreground/25" />
      <div className="typo-body font-medium text-foreground/85">Your cockpit is empty</div>
      <div className="typo-caption text-foreground/55 max-w-md text-center">
        Ask Athena to compose a cockpit view — try
        <span className="text-foreground/80"> "show me my personas" </span>
        or <span className="text-foreground/80">"what needs my attention"</span>.
      </div>
      <button
        type="button"
        onClick={onTalk}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-input typo-caption font-medium bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/30 transition-colors"
      >
        <MessageCircle className="w-3.5 h-3.5" />
        Talk to Athena
      </button>
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
