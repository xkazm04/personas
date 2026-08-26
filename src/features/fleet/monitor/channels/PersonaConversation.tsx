import {
  memo, Suspense, useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { MessagesSquare, Send } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { lazyRetry } from '@/lib/lazyRetry';
import { usePipelineStore } from '@/stores/pipelineStore';
import { EMPTY_PERSONA_CHANNEL } from '@/stores/slices/pipeline/personaChannelSlice';
import { getReport, deleteReport } from '@/api/overview/reports';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaReport } from '@/lib/types/types';
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

/**
 * Lift the report modal above the Monitor overlay.
 *
 * THE BUG THIS EXISTS FOR: the Persona Monitor is mounted by `TrayOverlays`
 * *inside* `<div class="titlebar">`, and `globals.css` gives `.titlebar`
 * `position:relative; z-index:9999` — a stacking context far above everything
 * else. `ReportDetailModal` → `DetailModal` → `BaseModal portal`, which
 * portals to `document.body`; and because `DetailModal` passes an explicit
 * `containerClassName` (`fixed inset-0 z-[200] …`), `BaseModal` deliberately
 * skips its own `zIndex: Z_INDEX_PORTAL_BASE (10000)` style
 * (`BaseModal.tsx` — `style={containerClassName ? undefined : {...}}`).
 * So the modal mounted at z-200 while the opaque `bg-background` monitor sat
 * at 9999: the fetch ran, the modal rendered, and the user saw nothing.
 *
 * (The team channel's `ChannelDetailModal` works from the same surface only
 * because it uses a NON-portal `BaseModal`, which renders in-tree inside the
 * monitor's own stacking context.)
 *
 * The real fix is one token in the shared `DetailModal` (stop hard-coding
 * `z-[200]`, or let `BaseModal` merge its portal z with a supplied container
 * class) — out of this change's scope, and it would move every DetailModal in
 * the app. Until then this lifts OUR overlay only, and no-ops the moment the
 * shared fix lands (it never lowers a container that is already high enough).
 */
const MONITOR_TITLEBAR_Z = 9999;
const REPORT_MODAL_Z = 10050;

function useLiftReportModal(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const lift = () => {
      // `detail-modal-title` is DetailModal's fixed titleId, so this reaches
      // exactly the overlay we opened and nothing else on <body>.
      const host = document.getElementById('detail-modal-title')?.closest('body > div');
      if (!(host instanceof HTMLElement)) return false;
      const current = Number.parseInt(window.getComputedStyle(host).zIndex, 10);
      if (!Number.isFinite(current) || current <= MONITOR_TITLEBAR_Z) {
        host.style.zIndex = String(REPORT_MODAL_Z);
      }
      return true;
    };
    // The modal is lazy, so it usually is not in the DOM on this first pass.
    if (lift()) return;
    const observer = new MutationObserver(() => {
      if (lift()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [open]);
}

function PersonaComposer({ persona }: { persona: Persona }) {
  const { t, tx } = useTranslation();
  const send = usePipelineStore((s) => s.sendPersonaChannelMessage);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // rAF-batched autosize — same C4 rationale as the team composer.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    });
    return () => cancelAnimationFrame(id);
  }, [draft]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    // Fire-and-forget: the echo renders instantly; a failed post marks the
    // echo in place and the door's rejection surfaces as a toast.
    void send(persona.id, text).catch(toastCatch('personaChannel:send'));
  };

  return (
    <div className="flex-shrink-0 border-t border-border bg-foreground/[0.02] px-3 py-2">
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={tx(t.monitor.conv_persona_composer_placeholder, { name: persona.name })}
          className="flex-1 resize-none px-3 py-2 rounded-input bg-secondary/30 border border-border typo-body text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-interactive border border-status-success/30 bg-status-success/10 typo-body text-status-success hover:bg-status-success/20 transition-colors disabled:opacity-40"
        >
          <Send className="w-4 h-4" aria-hidden />
          {t.monitor.conv_composer_send}
        </button>
      </div>
    </div>
  );
}

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
  const personaColor = persona.color;
  const renderRow = useCallback(
    (row: PersonaConversationRow) => {
      switch (row.kind) {
        case 'day':
          return (
            <div className="flex items-center gap-2 py-2">
              <span className="flex-1 h-px bg-border" />
              <span className="typo-caption text-foreground opacity-40">{dayLabel(row.at, dayWords)}</span>
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
                <PersonaChatBubble item={row.item} personaName={personaName} personaColor={personaColor} />
              );
          }
      }
    },
    [dayWords, personaName, personaColor, openReport, onResolvedReview],
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      {rows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
          <div className="relative">
            <div className="absolute inset-0 -m-6 rounded-full bg-primary/10 blur-2xl" />
            <MessagesSquare className="relative w-8 h-8 text-foreground opacity-70" />
          </div>
          <p className="typo-body text-foreground">{t.monitor.conv_persona_empty_title}</p>
          <p className="typo-caption text-foreground opacity-50 max-w-xs">{t.monitor.conv_persona_empty_body}</p>
        </div>
      ) : (
        <VirtualConversation rows={rows} renderRow={renderRow} hasMore={!st.exhausted} onTopReached={onTopReached} />
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
