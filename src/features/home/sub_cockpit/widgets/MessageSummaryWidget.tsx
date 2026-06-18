import { useMemo } from 'react';
import { ExternalLink, MessageSquare } from 'lucide-react';

import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { PersonaMessage } from '@/lib/types/types';

import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Message summary — contextual cockpit hero.
 *
 * Renders the persona, title, and a content excerpt for a specific message.
 * The originating "Play in chat" handler passes the full `PersonaMessage`
 * via `config.snapshot` (it already has the row in scope) so we render
 * synchronously without an extra fetch.
 *
 * Config:
 *   { messageId: string, snapshot?: PersonaMessage }
 */
export function MessageSummaryWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const messageId = (config?.messageId as string | undefined) ?? '';
  const snapshot = config?.snapshot as PersonaMessage | undefined;

  // Fallback path — if the widget is mounted without snapshot (future
  // surfaces composing this widget), pick the message from the overview
  // store cache. We do not fetch from the backend; the cockpit grid cell
  // should never block on IPC for a header card.
  const fromStore = useOverviewStore((s) => s.messages.find((m) => m.id === messageId));
  const msg = snapshot ?? fromStore;

  const personaName = msg?.persona_name ?? t.overview.messages_view.unknown_persona;
  const excerpt = useMemo(() => {
    const raw = msg?.content ?? '';
    const stripped = raw.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim();
    return stripped.length > 280 ? `${stripped.slice(0, 280)}…` : stripped;
  }, [msg?.content]);

  const openMessages = () => {
    useSystemStore.getState().setSidebarSection('overview');
    useOverviewStore.getState().setOverviewTab('messages');
    // Clear contextual cockpit so the user is back in normal overview flow.
    useSystemStore.getState().setContextualCockpit(null);
  };

  if (!msg) {
    return (
      <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col items-center justify-center gap-2 text-foreground">
        <MessageSquare className="w-5 h-5" />
        <div className="typo-caption">{t.overview.cockpit.message_unavailable}</div>
      </div>
    );
  }

  return (
    <div
      data-testid="cockpit-widget-message_summary"
      className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="typo-caption text-foreground uppercase tracking-wide">
          {title ?? t.overview.cockpit.message_summary_title}
        </div>
        <button
          type="button"
          onClick={openMessages}
          className="inline-flex items-center gap-1 typo-caption text-foreground hover:text-foreground/85 transition-colors"
        >
          {t.overview.cockpit.open_in_messages}
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      <div className="flex items-start gap-3 mb-3">
        <PersonaIcon
          icon={msg.persona_icon ?? null}
          color={msg.persona_color ?? null}
          display="framed"
          frameSize="md"
        />
        <div className="min-w-0 flex-1">
          <p className="typo-body-lg font-semibold text-foreground/95 truncate">
            {msg.title || t.overview.messages_view.message_label}
          </p>
          <p className="typo-caption text-foreground mt-0.5">
            {personaName} · {formatRelativeTime(msg.created_at)}
          </p>
        </div>
      </div>

      <p className="typo-body text-foreground leading-relaxed flex-1 overflow-y-auto min-h-0">
        {excerpt || <span className="italic text-foreground">{t.overview.cockpit.message_empty}</span>}
      </p>
    </div>
  );
}
