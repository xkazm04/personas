import { useCallback, useEffect, useState } from 'react';
import { Compass, Info, MessageCircle } from 'lucide-react';

import {
  companionGetCockpit,
  type CompanionCockpitSpec,
  type CompanionCockpitSpecBody,
  type CompanionCockpitWidget,
} from '@/api/companion';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import {
  ContentBody,
  ContentBox,
  ContentHeader,
} from '@/features/shared/components/layout/ContentLayout';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { silentCatch } from '@/lib/silentCatch';

import { cockpitRowSpan, cockpitWidgetRegistry } from './widgetRegistry';
import { DebtText } from '@/i18n/DebtText';


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
  const setCompanionState = useCompanionStore((s) => s.setState);
  const contextualCockpit = useSystemStore((s) => s.contextualCockpit);
  const setContextualCockpit = useSystemStore((s) => s.setContextualCockpit);

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
    // While a contextual overlay is active, skip the persistent fetch +
    // focus-refresh so the contextual widgets aren't clobbered by an
    // older LLM-composed spec coming back from the backend.
    if (contextualCockpit) return;
    load();
    const handler = () => load();
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [load, contextualCockpit]);

  // Active spec body: contextual overlay wins.
  let persistentBody: CompanionCockpitSpecBody | null = null;
  if (spec) {
    try {
      persistentBody = JSON.parse(spec.specJson) as CompanionCockpitSpecBody;
    } catch (err) { silentCatch("features/home/sub_cockpit/CockpitPanel:catch1")(err); }
  }
  const body = contextualCockpit ? contextualCockpit.spec : persistentBody;
  const widgets = body?.widgets ?? [];
  const headerTitle = contextualCockpit
    ? body?.title ?? t.overview.cockpit.title_default
    : body?.title ?? 'Cockpit';
  const headerSubtitle = contextualCockpit
    ? t.overview.cockpit.subtitle_contextual
    : spec
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
      <DebtText k="auto_talk_to_athena_4a34b995" />
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
        {contextualCockpit && (
          <div
            data-testid="cockpit-context-banner"
            className="flex items-center gap-3 px-4 py-2.5 rounded-card border border-primary/15 bg-primary/[0.04] mb-3"
          >
            <Info className="w-4 h-4 text-primary/70 flex-shrink-0" />
            <span className="typo-body text-foreground/85 truncate">
              {tx(t.overview.cockpit.context_for, {
                title: contextualCockpit.source.messageTitle || t.overview.messages_view.message_label,
              })}
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
        )}

        {!contextualCockpit && loading ? (
          <div className="flex items-center justify-center py-20">
            <LoadingSpinner size="lg" />
          </div>
        ) : !contextualCockpit && !spec ? (
          <CockpitEmptyState onTalk={composePersonaCockpit} />
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
        <div className="typo-body font-medium text-foreground/90"><DebtText k="auto_your_cockpit_is_empty_88e25bb2" /></div>
        <div className="typo-caption text-foreground">
          <DebtText k="auto_ask_athena_to_compose_a_cockpit_view_try_fcc2f4df" />
          <span className="text-foreground"> <DebtText k="auto_show_me_my_personas_796e0c66" /> </span>
          or <span className="text-foreground"><DebtText k="auto_what_needs_my_attention_70790810" /></span>.
        </div>
        <button
          type="button"
          onClick={onTalk}
          data-testid="cockpit-empty-talk-to-athena"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-input typo-caption font-medium bg-primary/15 hover:bg-primary/25 text-primary border border-primary/25 hover:border-primary/40 shadow-elevation-2 transition-colors"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          <DebtText k="auto_talk_to_athena_4a34b995" />
        </button>
      </div>
    </div>
  );
}

function CockpitWidgetCell({ widget }: { widget: CompanionCockpitWidget }) {
  const span = Math.max(1, Math.min(12, widget.span ?? 6));
  const rowSpan = cockpitRowSpan(widget.kind);
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
          <DebtText k="auto_unknown_widget_aedf060d" /> {widget.kind}
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
