import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Compass, Info, MessageCircle } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  companionGetCockpit,
  COMPANION_COMPOSE_COCKPIT_EVENT,
  type CompanionCockpitSpec,
  type CompanionCockpitSpecBody,
  type CompanionCockpitWidget,
} from '@/api/companion';
import { getMetricsSummary } from '@/api/overview/observability';
import type { MetricsSummary } from '@/lib/bindings/MetricsSummary';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { useTranslation } from '@/i18n/useTranslation';
import {
  ContentBody,
  ContentBox,
  ContentHeader,
} from '@/features/shared/components/layout/ContentLayout';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { silentCatch } from '@/lib/silentCatch';

import { AthenaComposedBadge } from '@/features/shared/components/feedback/AthenaComposedBadge';

import { cockpitRowSpan, cockpitWidgetRegistry } from './widgetRegistry';
import { composeDefaultCockpit, type DefaultCockpitLabels } from './defaultCockpit';
import { parseWidgetActions } from './briefing/actions';
import { WidgetActionBar } from './briefing/WidgetActionBar';

/** Window (days) for the default-cockpit fleet-vitals stat grid. */
const DEFAULT_COCKPIT_METRICS_DAYS = 7;


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
  const { t, tx } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [spec, setSpec] = useState<CompanionCockpitSpec | null>(null);
  // Distinguish a failed fetch from a genuinely-empty (never-composed) cockpit —
  // without this both collapse to spec===null, so a first-boot fetch error shows
  // the "your cockpit is empty" CTA instead of an error + retry.
  const [error, setError] = useState<unknown>(null);
  const setCompanionState = useCompanionStore((s) => s.setState);
  const contextualCockpit = useSystemStore((s) => s.contextualCockpit);
  const setContextualCockpit = useSystemStore((s) => s.setContextualCockpit);

  // Fleet state for the deterministic default cockpit (shown when the user
  // has never had Athena compose one). Both are already reachable client-side;
  // no LLM call. `personas` also feeds the persona_overview widget's own fetch.
  const { personas, fetchPersonas } = useAgentStore(
    useShallow((s) => ({ personas: s.personas, fetchPersonas: s.fetchPersonas })),
  );
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  // Metrics: once on mount. Keying this on `personas` refetched the summary on
  // every fleet-array identity change (renames, background refreshes).
  useEffect(() => {
    getMetricsSummary(DEFAULT_COCKPIT_METRICS_DAYS)
      .then(setMetrics)
      .catch(silentCatch('cockpit_metrics_summary'));
  }, []);
  // Personas: fetch-if-empty exactly once. An empty fleet re-produces the
  // guard state (fresh [] identity per fetch), which looped fetchPersonas
  // for as long as the panel was open on a zero-persona install.
  const personasRequestedRef = useRef(false);
  useEffect(() => {
    if ((!personas || personas.length === 0) && !personasRequestedRef.current) {
      personasRequestedRef.current = true;
      fetchPersonas().catch(silentCatch('cockpit_fetch_personas'));
    }
  }, [personas, fetchPersonas]);

  // Empty-state CTA: seed Athena with a concrete "compose a persona overview
  // cockpit" request and auto-send it, then open the chat panel so the user
  // sees the composition stream in. Mirrors MessageDetailModal's "Play in
  // chat" preset+autoSend pattern.
  const composePersonaCockpit = useCallback(() => {
    useCompanionStore.getState().setPendingPrompt({
      text: t.overview.cockpit.compose_personas_prompt,
      autoSend: true,
    });
    setCompanionState('open');
  }, [t, setCompanionState]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    companionGetCockpit()
      .then((s) => {
        setSpec(s);
        setLoading(false);
      })
      .catch((err: unknown) => {
        silentCatch('companion_get_cockpit')(err);
        setError(err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    // While a contextual overlay is active, skip the persistent fetch +
    // focus-refresh so the contextual widgets aren't clobbered by an
    // older LLM-composed spec coming back from the backend.
    if (contextualCockpit) return;
    load();
    const handler = () => load();
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [load, contextualCockpit]);

  // Athena just composed a cockpit: she persists the spec server-side and
  // emits this event. If the user was already on the Cockpit tab the panel
  // is mounted but stale — refetch so the new widgets render immediately
  // instead of waiting for a window-focus refresh or a forced re-render.
  // We also drop any transient contextual overlay: compose_cockpit means
  // "look at the persistent cockpit I just built for you".
  useTauriEvent<unknown>(
    COMPANION_COMPOSE_COCKPIT_EVENT,
    useCallback(() => {
      setContextualCockpit(null);
      load();
    }, [load, setContextualCockpit]),
    'cockpit_compose_listen',
  );

  const cockpit = t.overview.cockpit;

  // Active spec body: contextual overlay wins.
  let persistentBody: CompanionCockpitSpecBody | null = null;
  // Distinguish "spec fetched but corrupt" from "never composed" — both leave
  // persistentBody null, but only the former should surface as a visible
  // error instead of silently falling through to the empty-state CTA (a
  // corrupt persisted spec is a real degradation, not a first-boot state).
  let specParseFailed = false;
  if (spec) {
    try {
      persistentBody = JSON.parse(spec.specJson) as CompanionCockpitSpecBody;
    } catch (err) {
      specParseFailed = true;
      silentCatch("features/home/sub_cockpit/CockpitPanel:catch1")(err);
    }
  }

  // Deterministic starter cockpit — Athena's composed spec (persistentBody)
  // always wins; this only fills the never-composed gap, and only when there's
  // real fleet state to show. A brand-new install with zero personas keeps the
  // "talk to Athena" CTA.
  const defaultLabels = useMemo<DefaultCockpitLabels>(
    () => ({
      title: cockpit.default_title,
      callout: { title: cockpit.default_callout_title, body: cockpit.default_callout_body },
      vitalsTitle: cockpit.default_vitals_title,
      rosterTitle: cockpit.default_roster_title,
      attentionTitle: cockpit.default_attention_title,
      attentionEmpty: cockpit.default_attention_empty,
      stat: {
        activePersonas: cockpit.default_stat_active_personas,
        successRate: cockpit.default_stat_success_rate,
        executions: cockpit.default_stat_executions,
        needsAttention: cockpit.default_stat_needs_attention,
      },
      attentionReason: {
        setup: cockpit.default_attention_setup,
        disabled: cockpit.default_attention_paused,
        low_trust: cockpit.default_attention_low_trust,
      },
    }),
    [cockpit],
  );
  const showDefault =
    !contextualCockpit && !spec && !error && (personas?.length ?? 0) > 0;
  const defaultBody = useMemo(
    () => (showDefault ? composeDefaultCockpit(personas ?? [], metrics, defaultLabels) : null),
    [showDefault, personas, metrics, defaultLabels],
  );

  const body = contextualCockpit
    ? contextualCockpit.spec
    : persistentBody ?? defaultBody;
  const widgets = body?.widgets ?? [];
  const headerTitle = contextualCockpit
    ? body?.title ?? cockpit.title_default
    : defaultBody
      ? cockpit.default_title
      : body?.title ?? cockpit.title_default;
  const headerSubtitle: ReactNode = contextualCockpit
    ? contextualCockpit.source.kind === 'explain'
      ? cockpit.subtitle_explaining
      : contextualCockpit.source.kind === 'briefing'
        ? new Date(contextualCockpit.source.generatedAt).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          })
        : cockpit.subtitle_contextual
    : spec && !specParseFailed
      ? (
          <>
            {cockpit.subtitle_composed_prefix}{' '}
            <RelativeTime timestamp={spec.updatedAt} />
          </>
        )
      : defaultBody
        ? cockpit.default_subtitle
        : cockpit.subtitle_default;

  // Loading choreography (docs/design/overview-loading.md): grid tiles ripple
  // in once when the real spec lands (id-guarded — a compose_cockpit event or
  // a window-focus refetch that re-delivers the same widget ids never replays
  // the entrance). No resetKey: entries are latched for the panel's lifetime.
  const widgetEnter = useRevealTracker();

  const talkToAthena = (
    <button
      type="button"
      onClick={() => setCompanionState('open')}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-input typo-caption font-medium bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/30 transition-colors"
      data-testid="cockpit-talk-to-athena"
    >
      <MessageCircle className="w-3.5 h-3.5" />
      {cockpit.talk_to_athena}
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
        {contextualCockpit && contextualCockpit.source.kind === 'briefing' ? (
          <div
            data-testid="cockpit-briefing-banner"
            className="flex items-center gap-3 px-4 py-2.5 rounded-card border border-primary/15 bg-primary/[0.04] mb-3"
          >
            {contextualCockpit.source.composedBy === 'athena' ? (
              <AthenaComposedBadge
                variant="composed"
                label={t.overview.cockpit.briefing_composed_by}
                title={t.overview.cockpit.briefing_subtitle_athena}
              />
            ) : (
              <Info className="w-4 h-4 text-primary/70 flex-shrink-0" />
            )}
            <span className="typo-body text-foreground/85 truncate">
              {contextualCockpit.source.composedBy === 'fallback'
                ? t.overview.cockpit.briefing_subtitle_fallback
                : contextualCockpit.source.composedBy === 'quiet'
                  ? t.overview.cockpit.briefing_quiet_title
                  : t.overview.cockpit.briefing_title}
            </span>
            <button
              type="button"
              data-testid="cockpit-briefing-exit"
              onClick={() => setContextualCockpit(null)}
              className="ml-auto typo-caption text-primary hover:text-primary/80 transition-colors"
            >
              {t.overview.cockpit.context_exit}
            </button>
          </div>
        ) : contextualCockpit ? (
          <div
            data-testid="cockpit-context-banner"
            className="flex items-center gap-3 px-4 py-2.5 rounded-card border border-primary/15 bg-primary/[0.04] mb-3"
          >
            <Info className="w-4 h-4 text-primary/70 flex-shrink-0" />
            <span className="typo-body text-foreground/85 truncate">
              {contextualCockpit.source.kind === 'explain'
                ? tx(t.overview.cockpit.context_explaining, {
                    title:
                      contextualCockpit.source.decisionTitle ||
                      t.overview.cockpit.title_default,
                  })
                : contextualCockpit.source.kind === 'message'
                  ? tx(t.overview.cockpit.context_for, {
                      title:
                        contextualCockpit.source.messageTitle ||
                        t.overview.messages_view.message_label,
                    })
                  : null}
            </span>
            <button
              type="button"
              data-testid="cockpit-context-exit"
              onClick={() => setContextualCockpit(null)}
              className="ml-auto typo-caption text-primary hover:text-primary/80 transition-colors"
            >
              {t.overview.cockpit.context_exit}
            </button>
          </div>
        ) : null}

        {!contextualCockpit && loading && !spec ? (
          <CockpitGhostGrid />
        ) : !contextualCockpit && specParseFailed ? (
          <div className="rounded-modal border border-status-error/20 bg-status-error/5 p-6 flex flex-col items-center gap-3 text-center">
            <p className="typo-body text-status-error font-medium">{cockpit.error_title}</p>
            <button
              type="button"
              onClick={load}
              className="rounded-modal border border-primary/20 px-3 py-1.5 typo-body text-primary hover:bg-primary/10 transition-colors"
            >
              {cockpit.error_retry}
            </button>
          </div>
        ) : !contextualCockpit && error && !spec ? (
          <div className="rounded-modal border border-status-error/20 bg-status-error/5 p-6 flex flex-col items-center gap-3 text-center">
            <p className="typo-body text-status-error font-medium">{cockpit.error_title}</p>
            <button
              type="button"
              onClick={load}
              className="rounded-modal border border-primary/20 px-3 py-1.5 typo-body text-primary hover:bg-primary/10 transition-colors"
            >
              {cockpit.error_retry}
            </button>
          </div>
        ) : !contextualCockpit && !spec && !defaultBody ? (
          <CockpitEmptyState onTalk={composePersonaCockpit} />
        ) : (
          <div className="grid grid-cols-12 gap-3 auto-rows-[180px]">
            {widgets.map((w, i) => (
              <CockpitWidgetCell key={w.id} widget={w} order={i} enter={widgetEnter} />
            ))}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}

// ---------------------------------------------------------------------------
// CockpitGhostGrid — calm, delayed ghost of the widget grid for the ONLY
// moment the panel has nothing to show yet (cold `companionGetCockpit` fetch,
// no persisted/default spec on hand). Geometry approximates
// `composeDefaultCockpit`'s 4-widget starter layout (orientation callout ·
// fleet vitals · persona roster · needs-attention triage) — same span-12
// tiles at the same row spans (2/2/3/3) real content will occupy, so the
// ghost→content swap moves nothing. Each tile is invisible for its first
// ~150ms (`animate-fade-in` + `fill-mode: both`), so a fast fetch never
// paints a single one. Header chrome (ContentHeader above) always renders.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
const GHOST_TILES: { rowSpan: number; bars: number }[] = [
  { rowSpan: 2, bars: 1 },
  { rowSpan: 2, bars: 4 },
  { rowSpan: 3, bars: 3 },
  { rowSpan: 3, bars: 3 },
];

function CockpitGhostGrid() {
  return (
    <div className="grid grid-cols-12 gap-3 auto-rows-[180px]" aria-hidden="true">
      {GHOST_TILES.map((tile, i) => (
        <div
          key={i}
          style={{
            gridColumn: 'span 12 / span 12',
            gridRow: `span ${tile.rowSpan} / span ${tile.rowSpan}`,
            animationDelay: `${150 + i * 35}ms`,
          }}
          className="min-h-0 rounded-modal border border-primary/10 bg-secondary/[0.03] p-4 flex flex-col gap-2 animate-fade-in"
        >
          <span className={`h-3 w-32 ${GHOST_BAR}`} />
          <div className="flex-1 grid grid-cols-4 gap-2">
            {Array.from({ length: tile.bars }).map((_, j) => (
              <span key={j} className={`h-full ${GHOST_BAR}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CockpitEmptyState({ onTalk }: { onTalk: () => void }) {
  const { t, tx } = useTranslation();
  const cockpit = t.overview.cockpit;
  return (
    <div
      data-testid="cockpit-empty-state"
      className="relative overflow-hidden rounded-modal border border-primary/10 min-h-[440px] flex flex-col items-center justify-end text-center"
    >
      {/* Athena baseline portrait as an atmospheric background. The gradient
          overlay below it keeps the foreground copy legible across themes. */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <img
          src="/athena/athena_baseline.jpg"
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover object-top opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/40 via-transparent to-background/40" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4 px-6 pb-10 max-w-md">
        <div className="typo-body font-medium text-foreground/90">{cockpit.empty_title}</div>
        <div className="typo-caption text-foreground">
          {tx(cockpit.empty_hint, {
            personas: cockpit.empty_example_personas,
            attention: cockpit.empty_example_attention,
          })}
        </div>
        <button
          type="button"
          onClick={onTalk}
          data-testid="cockpit-empty-talk-to-athena"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-input typo-caption font-medium bg-primary/15 hover:bg-primary/25 text-primary border border-primary/25 hover:border-primary/40 shadow-elevation-2 transition-colors"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          {cockpit.talk_to_athena}
        </button>
      </div>
    </div>
  );
}

interface CockpitWidgetCellProps {
  widget: CompanionCockpitWidget;
  /** Position in the current grid — drives the entrance stagger order. */
  order: number;
  /** Id-guarded reveal tracker shared across the grid (latched for the panel's lifetime). */
  enter: { hasEntered: (id: string) => boolean; markEntered: (id: string) => void };
}

function CockpitWidgetCell({ widget, order, enter }: CockpitWidgetCellProps) {
  const { t, tx } = useTranslation();
  const span = Math.max(1, Math.min(12, widget.span ?? 6));
  const rowSpan = cockpitRowSpan(widget.kind);
  const Component = cockpitWidgetRegistry[widget.kind];
  // Morning Director: enum-validated one-click actions (re-parsed here —
  // never trust a stored/composed spec's raw shape).
  const actions = useMemo(() => parseWidgetActions(widget.actions), [widget.actions]);
  return (
    <RevealItem
      revealId={widget.id}
      order={order}
      hasEntered={enter.hasEntered}
      markEntered={enter.markEntered}
      style={{
        gridColumn: `span ${span} / span ${span}`,
        gridRow: `span ${rowSpan} / span ${rowSpan}`,
      }}
      className="min-h-0"
    >
      <div className="h-full flex flex-col min-h-0">
        <div className="flex-1 min-h-0">
          {Component ? (
            <Component title={widget.title} config={widget.config} />
          ) : (
            <div className="rounded-card border border-status-error/30 bg-status-error/[0.06] p-4 typo-caption text-status-error h-full flex items-center justify-center">
              {tx(t.overview.cockpit.unknown_widget, { kind: widget.kind })}
            </div>
          )}
        </div>
        <WidgetActionBar actions={actions} />
      </div>
    </RevealItem>
  );
}
