import { useMemo } from 'react';

import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useTranslation } from '@/i18n/useTranslation';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { KitButton, Meta, Tile } from '@/features/shared/components/kit';
import type { PersonaReport } from '@/lib/types/types';

import type { CockpitWidgetProps } from '../widgetRegistry';

/** The summary reads the report's opening blocks up to about this many characters. */
const EXCERPT_CHARS = 600;

/**
 * Message summary - contextual cockpit hero, as one kit Tile: the message's own
 * title is the tile title (persona and age in its meta line, "Open in Reports"
 * top-right), the body is the report's opening rendered as markdown by the
 * app's shared renderer (never printed raw).
 * The originating "Play in chat" handler passes the full `PersonaReport`
 * via `config.snapshot` (it already has the row in scope) so we render
 * synchronously without an extra fetch.
 *
 * Config:
 *   { messageId: string, snapshot?: PersonaReport }
 */
export function ReportSummaryWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const c = t.overview.cockpit;
  const messageId = (config?.messageId as string | undefined) ?? '';
  const snapshot = config?.snapshot as PersonaReport | undefined;

  // Fallback path - if the widget is mounted without snapshot (future
  // surfaces composing this widget), pick the message from the overview
  // store cache. We do not fetch from the backend; the cockpit grid cell
  // should never block on IPC for a header card.
  const fromStore = useOverviewStore((s) => s.reports.find((m) => m.id === messageId));
  const msg = snapshot ?? fromStore;
  const excerpt = useMemo(() => openingBlocks(msg?.content ?? ''), [msg?.content]);

  const openMessages = () => {
    useSystemStore.getState().setSidebarSection('overview');
    useOverviewStore.getState().setOverviewTab('messages');
    // Clear contextual cockpit so the user is back in normal overview flow.
    useSystemStore.getState().setContextualCockpit(null);
  };

  if (!msg) {
    return (
      <Tile
        span={span}
        title={title ?? c.report_summary_title}
        actions={actions}
        footer={footer}
        testId="cockpit-widget-message_summary"
        state="empty"
        empty={{ title: c.report_unavailable }}
      />
    );
  }

  return (
    <Tile
      span={span}
      title={title ?? (msg.title || t.overview.reports_view.report_label)}
      meta={<Meta parts={[msg.persona_name ?? t.overview.reports_view.unknown_persona, formatRelativeTime(msg.created_at)]} />}
      actions={<><KitButton tone="quiet" onClick={openMessages}>{c.open_in_reports}</KitButton>{actions}</>}
      footer={footer}
      testId="cockpit-widget-message_summary"
      state={excerpt ? undefined : 'empty'}
      empty={{ title: c.report_empty }}
    >
      <div className="k-in">
        <MarkdownRenderer content={excerpt} variant="card" />
      </div>
    </Tile>
  );
}

/**
 * The report's opening: code fences dropped (a summary is prose), then whole
 * markdown blocks until about EXCERPT_CHARS, so a heading, list or bold span is
 * never cut in half; the full report is one press away in Reports.
 */
function openingBlocks(raw: string): string {
  const blocks = raw.replace(/```[\s\S]*?```/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const kept: string[] = [];
  let size = 0;
  for (const block of blocks) {
    if (kept.length > 0 && size + block.length > EXCERPT_CHARS) break;
    kept.push(block);
    size += block.length;
  }
  return kept.join('\n\n');
}
