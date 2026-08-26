import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, Bookmark, Check, ExternalLink, FileText, Loader2, Radio, Sparkles, X,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { severityBucket, SEVERITY_META } from '@/features/fleet/monitor/monitorModel';
import { parseSuggestedActions } from '@/lib/reviews/suggestedActions';
import { dispatchReviewRowAction, resolveReviewRow } from '@/lib/decisions/rowWrites';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import type { PersonaChannelItem } from '@/lib/bindings/PersonaChannelItem';
import { parseItemExtra, reviewStatusOf } from './personaConversationModel';

/* ----------------------------------------------------------------------------
 * PERSONA CONVERSATION CARDS — the row kinds of a persona's channel.
 *
 * Same geometry thesis as the team conversation: talk is inset bubbles,
 * artifacts are full-width bands, machine noise is one subtle centered line.
 * All rows are memo'd against C1's identity-preserving refresh — a quiet poll
 * re-renders nothing.
 * -------------------------------------------------------------------------- */

/**
 * Chat-tightened markdown rhythm: paragraph/list/heading spacing compressed so
 * a two-line remark doesn't inherit document layout. Same set the team
 * conversation's TalkBubble uses (ConversationCards.tsx) — the full document
 * rhythm belongs to the detail modal, never to a bubble.
 */
const MD_CHAT_RHYTHM =
  '[&_p]:mb-1.5 [&_p]:leading-normal [&_p:last-child]:mb-0 [&_ul]:mb-1.5 [&_ul:last-child]:mb-0 ' +
  '[&_ol]:mb-1.5 [&_ol:last-child]:mb-0 [&_pre]:mb-1.5 [&_table]:my-2 [&_h1]:mt-2 [&_h2]:mt-2 [&_h3]:mt-1.5';

/* ── CHAT ──────────────────────────────────────────────────────────────────── */

export const PersonaChatBubble = memo(function PersonaChatBubble({
  item, personaName, personaColor,
}: {
  item: PersonaChannelItem;
  personaName: string;
  personaColor: string | null;
}) {
  const { t } = useTranslation();
  const mine = item.authorKind === 'user';
  const extra = parseItemExtra(item);
  const pending = extra.pending === true;
  const failed = extra.failed === true;

  return (
    <div className={`py-1 flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] px-3 py-2 rounded-card border transition-opacity ${
          mine
            ? failed
              ? 'bg-status-error/[0.07] border-status-error/35'
              : 'bg-primary/12 border-primary/20'
            : 'bg-secondary/30 border-border'
        } ${pending ? 'opacity-60' : ''}`}
      >
        {!mine && (
          <span className="flex items-center gap-1.5 mb-0.5">
            {item.authorKind === 'athena' && <Sparkles className="w-3 h-3 text-violet-300" />}
            <span className="typo-caption font-medium" style={{ color: personaColor ?? undefined }}>
              {item.authorKind === 'athena' ? 'Athena' : personaName}
            </span>
            <span className="typo-caption text-foreground opacity-35">
              <RelativeTime timestamp={item.at} />
            </span>
          </span>
        )}
        <MarkdownRenderer
          content={item.body ?? ''}
          className={`typo-body text-foreground break-words ${MD_CHAT_RHYTHM}`}
        />
        {pending && (
          <span className="mt-0.5 flex items-center gap-1 typo-caption text-foreground opacity-45">
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
            {t.monitor.conv_persona_sending}
          </span>
        )}
        {failed && (
          <span className="mt-0.5 block typo-caption text-status-error">{t.monitor.conv_persona_failed}</span>
        )}
      </div>
    </div>
  );
});

/* ── WORKING INDICATOR — the persona owes a reply ──────────────────────────── */

export const PersonaWorkingRow = memo(function PersonaWorkingRow({ personaName }: { personaName: string }) {
  const { t, tx } = useTranslation();
  return (
    <div className="py-1 flex justify-start">
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-border bg-secondary/20 typo-caption text-foreground opacity-60">
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
        {tx(t.monitor.conv_persona_working, { name: personaName })}
      </span>
    </div>
  );
});

/* ── REPORT — a compact bubble with an attachment chip ─────────────────────── */

/**
 * The preview's visual clamp. `line-clamp-*` needs `display:-webkit-box`,
 * which collapses markdown's block children (lists, tables, fenced code) into
 * one inline run — so the clamp is a max-height box instead, and the cut is
 * softened with a MASK rather than a gradient overlay: the bubble sits on a
 * translucent `bg-secondary/20` whose effective color no single `from-*` stop
 * can match, and a mask fades whatever is actually behind it.
 */
const REPORT_PREVIEW_FADE = 'linear-gradient(to bottom, #000 65%, transparent 100%)';

export const PersonaReportBubble = memo(function PersonaReportBubble({
  item, onOpenReport,
}: {
  item: PersonaChannelItem;
  /** Fetches `get_report(reportId)` and opens the detail modal. */
  onOpenReport: (reportId: string) => void;
}) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLDivElement>(null);
  // Fade only when the preview actually overflows — a two-line report must not
  // render with its last line dissolving for no reason.
  const [overflows, setOverflows] = useState(false);
  const body = item.body ?? '';

  useEffect(() => {
    const box = boxRef.current;
    const ink = inkRef.current;
    if (!box || !ink) return;
    const measure = () => setOverflows(ink.offsetHeight - box.clientHeight > 2);
    measure();
    // The markdown body reflows as the bubble's width settles (the row is
    // virtualized and measured after mount), so watch the ink, not the clamp.
    const ro = new ResizeObserver(measure);
    ro.observe(ink);
    return () => ro.disconnect();
  }, [body]);

  const openReport = useCallback(() => {
    if (item.reportId) onOpenReport(item.reportId);
  }, [item.reportId, onOpenReport]);

  return (
    <div className="py-1 flex justify-start">
      <div className="max-w-[78%] min-w-0 px-3 py-2 rounded-card border border-border bg-secondary/20">
        <span className="flex items-center gap-1.5 mb-0.5">
          <span className="typo-body font-semibold text-foreground truncate">
            {item.title ?? t.monitor.conv_persona_report_chip}
          </span>
          <span className="flex-shrink-0 typo-caption text-foreground opacity-35">
            <RelativeTime timestamp={item.at} />
          </span>
        </span>
        {body && (
          <div
            ref={boxRef}
            className="max-h-28 overflow-hidden"
            style={
              overflows
                ? { maskImage: REPORT_PREVIEW_FADE, WebkitMaskImage: REPORT_PREVIEW_FADE }
                : undefined
            }
          >
            <div ref={inkRef}>
              <MarkdownRenderer
                content={body}
                className={`typo-caption text-foreground opacity-70 break-words ${MD_CHAT_RHYTHM}`}
              />
            </div>
          </div>
        )}
        {item.reportId && (
          <button
            type="button"
            onClick={openReport}
            className="mt-1.5 inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 rounded-full border border-primary/25 bg-primary/10 typo-caption text-foreground hover:bg-primary/20 transition-colors"
          >
            <FileText className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
            {t.monitor.conv_persona_report_chip}
          </button>
        )}
      </div>
    </div>
  );
});

/* ── SYSTEM LINES — events and memories, never bubbles ─────────────────────── */

export const PersonaSystemLine = memo(function PersonaSystemLine({ item }: { item: PersonaChannelItem }) {
  const { t, tx } = useTranslation();
  const memory = item.kind === 'memory';
  const Icon = memory ? Bookmark : Radio;
  const text = memory
    ? tx(t.monitor.conv_persona_memory_saved, { title: item.title ?? '' })
    : tx(t.monitor.conv_persona_event_emitted, { event: item.title ?? '' });
  return (
    <div className="py-0.5 flex items-center justify-center gap-1.5">
      <Icon className="w-3 h-3 text-foreground opacity-35 flex-shrink-0" aria-hidden />
      <span className="typo-caption text-foreground opacity-45 truncate">{text}</span>
      <span className="typo-caption text-foreground opacity-30 flex-shrink-0">
        <RelativeTime timestamp={item.at} />
      </span>
    </div>
  );
});

/* ── REVIEW — the quick-decide card, staying in place as the record ────────── */

const REVIEW_ACCENT: Record<string, string> = {
  critical: 'border-red-500/30 bg-red-500/[0.05]',
  warning: 'border-amber-500/30 bg-amber-500/[0.05]',
  info: 'border-border bg-secondary/15',
};

export const PersonaReviewCard = memo(function PersonaReviewCard({
  item, onResolved,
}: {
  item: PersonaChannelItem;
  /** Fired after a verdict lands — the caller refreshes the channel so the
   *  card re-renders as its decision record. */
  onResolved: () => void;
}) {
  const { t } = useTranslation();
  const status = reviewStatusOf(item);
  const pending = status === 'pending';
  const bucket = severityBucket(item.severity ?? 'info');
  const sev = SEVERITY_META[bucket];
  const actions = parseSuggestedActions(item.suggestedActions);
  const [busy, setBusy] = useState<string | null>(null);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);

  const row = { id: item.reviewId ?? '', execution_id: item.executionId ?? '', source: 'local' as const };

  const run = (key: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    fn()
      .then(onResolved)
      // Every door in rowWrites rejects on a failed write — surface it.
      .catch(toastCatch('personaChannel:review'))
      .finally(() => setBusy(null));
  };

  const openInReviews = () => {
    setOverviewTab('manual-review');
    setSidebarSection('overview');
  };

  const statusLabel =
    status === 'approved'
      ? t.monitor.conv_persona_review_approved
      : status === 'rejected'
        ? t.monitor.conv_persona_review_rejected
        : t.monitor.conv_persona_review_resolved;

  return (
    <div className={`my-2 rounded-card border overflow-hidden ${REVIEW_ACCENT[bucket] ?? REVIEW_ACCENT.info}`}>
      <div className="px-3 py-2">
        <span className="flex items-center gap-2 min-w-0">
          <AlertCircle className={`w-4 h-4 flex-shrink-0 ${sev.text}`} aria-hidden />
          <span className="typo-body font-medium text-foreground truncate min-w-0 flex-1">{item.title}</span>
          {!pending && (
            <span className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border typo-caption ${sev.badge}`}>
              {status === 'rejected' ? <X className="w-3 h-3" aria-hidden /> : <Check className="w-3 h-3" aria-hidden />}
              {statusLabel}
            </span>
          )}
          <span className="flex-shrink-0 typo-caption text-foreground opacity-35">
            <RelativeTime timestamp={item.at} />
          </span>
        </span>
        {item.body && (
          <p className="mt-1 typo-caption text-foreground opacity-70 line-clamp-3 whitespace-pre-wrap break-words">
            {item.body}
          </p>
        )}

        {pending ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
            {/* Choosing a suggested action records the branch AND dispatches
                the follow-up run — the one door in rowWrites. */}
            {actions.map((a) => (
              <Button
                key={a}
                variant="secondary"
                size="xs"
                className="whitespace-nowrap"
                loading={busy === a}
                disabled={busy !== null && busy !== a}
                onClick={() => run(a, () => dispatchReviewRowAction(row, a))}
              >
                {a}
              </Button>
            ))}
            {/* The verdict cluster is ONE flex item, so a crowded row wraps it
                as a unit rather than orphaning "Open in reviews" on its own. */}
            <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
              <Button
                variant="danger"
                size="xs"
                className="whitespace-nowrap"
                icon={<X className="w-3 h-3" aria-hidden />}
                loading={busy === 'rejected'}
                disabled={busy !== null && busy !== 'rejected'}
                onClick={() => run('rejected', () => resolveReviewRow(row, 'rejected'))}
              >
                {t.monitor.quick_reject}
              </Button>
              <Button
                variant="primary"
                size="xs"
                className="whitespace-nowrap"
                icon={<Check className="w-3 h-3" aria-hidden />}
                loading={busy === 'approved'}
                disabled={busy !== null && busy !== 'approved'}
                onClick={() => run('approved', () => resolveReviewRow(row, 'approved'))}
              >
                {t.monitor.quick_approve}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="whitespace-nowrap"
                icon={<ExternalLink className="w-3 h-3" aria-hidden />}
                onClick={openInReviews}
              >
                {t.monitor.conv_persona_review_open}
              </Button>
            </span>
          </div>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              className="whitespace-nowrap"
              icon={<ExternalLink className="w-3 h-3" aria-hidden />}
              onClick={openInReviews}
            >
              {t.monitor.conv_persona_review_open}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});
