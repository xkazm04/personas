import { memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { lazyRetry } from '@/lib/lazyRetry';
import { usePipelineStore } from '@/stores/pipelineStore';
import { EMPTY_PERSONA_CHANNEL } from '@/stores/slices/pipeline/personaChannelSlice';
import { getReport, deleteReport } from '@/api/overview/reports';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaReport } from '@/lib/types/types';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ConversationGhostRows } from './ConversationGhostRows';
import { PersonaComposer } from './PersonaComposer';
import { useLiftReportModal } from './useLiftReportModal';
import { Engraved } from '../grid/prototype/entry-e/parts';
import { VirtualConversation } from './VirtualConversation';
import { dayLabel } from './conversationModel';
import {
  buildPersonaConversation,
  type PersonaConversationRow,
} from './personaConversationModel';
import {
  PersonaChatBubble,
  PersonaReportBubble,
  PersonaReviewCard,
  PersonaSystemLine,
  PersonaWorkingRow,
} from './PersonaConversationCards';

/* ----------------------------------------------------------------------------
 * PERSONA CONVERSATION — the team conversation's sibling, for one persona.
 *
 * Same VirtualConversation, same day separators, different row vocabulary:
 * chat bubbles, report bubbles with an attachment chip (the full artifact
 * opens in ReportDetailModal — never a second viewer), events/memories as
 * subtle system lines, reviews as quick-decide cards that stay in place as
 * their decision record.
 *
 * The composer is plain send only: no Route (goal decomposition is a team
 * concept), no @-mentions (there is exactly one interlocutor). Send is never
 * disabled — consecutive sends queue as more optimistic echoes.
 * -------------------------------------------------------------------------- */

// Lazy: the modal drags markdown/print/PDF machinery — not worth the channel
// workspace's chunk. It renders as an overlay, so a null fallback is one
// frame of nothing over an unchanged page, not a blanked surface.
// `lazyRetry` (not bare `lazy`): React caches a rejected lazy factory forever,
// so one transient chunk failure would leave this chip permanently dead.
const ReportDetailModal = lazyRetry(() =>
  import('@/features/overview/sub_reports/components/ReportDetailModal').then((m) => ({
    default: m.ReportDetailModal,
  })),
);

export const PersonaConversation = memo(function PersonaConversation({ persona }: { persona: Persona }) {
  const { t } = useTranslation();
  const subscribe = usePipelineStore((s) => s.subscribePersonaChannel);
  const loadOlder = usePipelineStore((s) => s.loadOlderPersonaChannel);
  const markSeen = usePipelineStore((s) => s.markPersonaChannelSeen);
  const refresh = usePipelineStore((s) => s.refreshPersonaChannel);
  // Per-key selector — another persona's refresh must not re-render this one.
  const st =
    usePipelineStore((s) => s.personaChannels[persona.id]) ?? EMPTY_PERSONA_CHANNEL;

  useEffect(() => subscribe(persona.id), [subscribe, persona.id]);

  // Opening the conversation marks it read — the sidebar badge watermark.
  const { loaded } = st;
  useEffect(() => {
    if (loaded) markSeen(persona.id);
  }, [loaded, markSeen, persona.id]);

  const rows = useMemo(
    () => buildPersonaConversation(st.items, st.echoes),
    [st.items, st.echoes],
  );

  // Report attachment chip → fetch the full artifact, open the existing modal.
  // `reportId` is the RAW `persona_reports.id`; the channel item's own id is
  // the `prep-`-namespaced twin and would 404 against `get_report`.
  const [report, setReport] = useState<PersonaReport | null>(null);
  const openReport = useCallback((reportId: string) => {
    if (!reportId) return;
    getReport(reportId)
      .then((r) => setReport(r))
      .catch(toastCatch('personaChannel:openReport'));
  }, []);
  useLiftReportModal(report !== null);
  const closeReport = useCallback(() => setReport(null), []);
  const removeReport = useCallback(async () => {
    if (!report) return;
    try {
      await deleteReport(report.id);
      setReport(null);
      void refresh(persona.id);
    } catch (e) {
      toastCatch('personaChannel:deleteReport')(e);
    }
  }, [report, refresh, persona.id]);

  const onResolvedReview = useCallback(() => {
    refresh(persona.id).catch(silentCatch('personaChannel:reviewRefresh'));
  }, [refresh, persona.id]);

  const onTopReached = useCallback(() => {
    void loadOlder(persona.id);
  }, [loadOlder, persona.id]);

  const dayWords = useMemo(
    () => ({ today: t.monitor.conv_day_today, yesterday: t.monitor.conv_day_yesterday }),
    [t],
  );

  // Stable-closure renderRow (C2/C3): keyed callbacks only, so the memo'd
  // cards bail unless their own row changed.
  const personaName = persona.name.replace(/^T:\s*/, '');
  const renderRow = useCallback(
    (row: PersonaConversationRow) => {
      switch (row.kind) {
        case 'day':
          return (
            <div className="flex items-center gap-2 py-2">
              <span className="flex-1 h-px bg-border" />
              <Engraved>{dayLabel(row.at, dayWords)}</Engraved>
              <span className="flex-1 h-px bg-border" />
            </div>
          );
        case 'working':
          return <PersonaWorkingRow personaName={personaName} />;
        case 'item':
          switch (row.item.kind) {
            case 'report':
              return <PersonaReportBubble item={row.item} onOpenReport={openReport} />;
            case 'review':
              return <PersonaReviewCard item={row.item} onResolved={onResolvedReview} />;
            case 'event':
            case 'memory':
              return <PersonaSystemLine item={row.item} />;
            default:
              return (
                <PersonaChatBubble item={row.item} persona={persona} />
              );
          }
      }
    },
    [dayWords, personaName, persona, openReport, onResolvedReview],
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      {/* Same loading switch as the team channel (overview-loading SS A): a
          cold persona channel showed the SETTLED empty state for the whole of
          its first fetch. Ghosts into emptiness only; the empty state waits
          until `loaded`. */}
      {!loaded && rows.length === 0 ? (
        <ConversationGhostRows count={4} />
      ) : rows.length === 0 ? (
        <ScenarioEmptyState
          className="flex-1 justify-center"
          art="chat"
          size="sm"
          title={t.monitor.conv_persona_empty_title}
          subtitle={t.monitor.conv_persona_empty_body}
        />
      ) : (
        <VirtualConversation
          rows={rows}
          renderRow={renderRow}
          hasMore={!st.exhausted}
          onTopReached={onTopReached}
          revealKey={persona.id}
        />
      )}

      <PersonaComposer persona={persona} />

      {report && (
        <Suspense fallback={null}>
          <ReportDetailModal message={report} onClose={closeReport} onDelete={removeReport} />
        </Suspense>
      )}
    </div>
  );
});
