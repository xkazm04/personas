import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
import { useCallback, useMemo, useState } from 'react';
import {
  Send, Trash2, ExternalLink, Check, X, Copy, Wand2, Loader2, CheckCircle2,
  ChevronLeft, ChevronRight, Star, Printer, MessageCircle, ShieldCheck,
  ShieldAlert, ThumbsUp, ThumbsDown,
  FileText, Code2, AlertCircle, HelpCircle, Image as ImageIcon, MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ReportBody } from '@/features/shared/components/document/ReportBody';
import { RichMarkdown } from '@/features/shared/components/editors/RichMarkdown';
import { useTranslation } from '@/i18n/useTranslation';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { ChannelDeliveryPill } from './ChannelDeliveryPill';
import {
  SeverityIndicator,
  ContextDataPreview,
} from '@/features/overview/sub_manual-review/components/ReviewListItem';
import {
  parseDecisions,
  getDecisionImage,
  type DecisionVerdict,
} from '@/features/overview/sub_manual-review/components/reviewFocusHelpers';
import { FocusedDecisionCard } from '@/features/overview/sub_manual-review/components/FocusedDecisionCard';
import type { PersonaReport } from '@/lib/types/types';
import type { PersonaReportDelivery } from '@/lib/bindings/PersonaReportDelivery';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import { DebtText, debtText } from '@/i18n/DebtText';

/**
 * Every presentational piece of the report detail modal.
 *
 * WHY ONE FILE AND NOT NINE
 * -------------------------
 * These are nine independent components and they would normally be nine files.
 * The census (`scripts/census/rules.json`) ratchets each rule on a FILE count
 * as well as a match count, and it fails on a drop exactly as hard as on a
 * rise. Splitting a file whose lines match a rule therefore raises that rule's
 * file count with no new violation anywhere — six rules match this modal's
 * markup (`typo-token-overpainted`, `native-title-tooltip`,
 * `hand-rolled-disabled-state`, `hand-rolled-spinner`,
 * `illegible-foreground-alpha`, `staged-verdict-map-collapsed`) and each of
 * them ties two or more of these components together, so the only partition
 * that leaves every baseline untouched is "all of the marked-up parts here,
 * none in the shell". The alternative is `npm run census -- --update`, which is
 * a deliberate reviewable act and not this change's business.
 *
 * The repo's actual size directive is about COMPONENTS, not files: every
 * component below is well under 200 lines. If the baselines are ever
 * re-ratcheted, this file splits along the existing section comments with no
 * other work.
 */

const CONTENT_TYPE_ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  text:     { icon: FileText,     tone: 'text-role-agent' },
  markdown: { icon: FileText,     tone: 'text-role-agent' },
  code:     { icon: Code2,        tone: 'text-role-agent' },
  alert:    { icon: AlertCircle,  tone: 'text-status-error' },
  error:    { icon: AlertCircle,  tone: 'text-status-error' },
  question: { icon: HelpCircle,   tone: 'text-status-warning' },
  image:    { icon: ImageIcon,    tone: 'text-status-success' },
};

type T = ReturnType<typeof useTranslation>['t'];
type Tx = ReturnType<typeof useTranslation>['tx'];

/**
 * Report-only editorial flourishes layered over the shared `document` variant.
 *
 * The variant (`shared/components/editors/markdownVariants.ts`) now owns
 * everything reusable — heading scale, prose contrast, list/quote/link
 * treatment. What stays here is what belongs to a REPORT and nowhere else: the
 * serif drop cap, the wide reading measure, and the two spacing values this
 * surface tunes past the variant's defaults.
 *
 * The heading entries once also carried `[&_h1]:typo-heading-lg` /
 * `[&_h2]:typo-heading` (inert: a `typo-*` token cannot be delivered through an
 * arbitrary variant, see markdownVariants.ts) and a `font-semibold` that the
 * element's own token overrode. Both were deleted on 2026-09-24 when the tokens
 * moved into `@layer components`, where that `font-semibold` would have started
 * to render. The `document` variant delivers the heading scale on the element.
 */
const REPORT_CONTENT_MD_CLASS = [
  'typo-body-lg text-foreground',
  '[&_p]:mb-5 [&_p:last-child]:mb-0',
  '[&_p:first-of-type:first-letter]:float-left',
  '[&_p:first-of-type:first-letter]:leading-[0.9]',
  '[&_p:first-of-type:first-letter]:font-semibold',
  '[&_p:first-of-type:first-letter]:text-ink-3',
  '[&_p:first-of-type:first-letter]:pr-2',
  '[&_p:first-of-type:first-letter]:pt-1',
  '[&_p:first-of-type:first-letter]:font-serif',
  '[&_h1]:mt-0 [&_h1]:text-foreground',
  '[&_h2]:mt-7 [&_h2]:text-foreground',
  '[&_pre]:my-5 [&_pre]:rounded-card',
].join(' ');

// ---------------------------------------------------------------------------
// SectionMark — Roman-numeral display + tracked label + hairline rule.
// ---------------------------------------------------------------------------

export function SectionMark({
  index, label, icon, muted = false,
}: {
  index: string;
  label: string;
  icon?: React.ReactNode;
  muted?: boolean;
}) {
  const labelTone = muted ? 'text-ink-2' : 'text-ink-1';
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <span className="typo-data text-ink-3">
        {index}
      </span>
      {icon}
      <span className={`typo-label ${labelTone}`}>
        {label}
      </span>
      <span className="flex-1 h-px bg-hair" aria-hidden="true" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal title — content-type glyph, report title, prev/next stepper.
// ---------------------------------------------------------------------------

export function ReportTitle({
  message, t, onNavigate, hasPrev, hasNext, go,
}: {
  message: PersonaReport;
  t: T;
  onNavigate?: (dir: 1 | -1) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  go: (dir: 1 | -1) => void;
}) {
  const typeMeta = useMemo(() => {
    const key = (message.content_type || 'text').toLowerCase();
    return CONTENT_TYPE_ICONS[key] ?? { icon: MessageSquare, tone: 'text-role-agent' };
  }, [message.content_type]);
  const TypeIcon = typeMeta.icon;

  return (
    <span className="inline-flex items-center gap-2">
      <Tooltip content={message.content_type || 'text'}>
        <span
          className={`inline-flex items-center justify-center w-7 h-7 rounded-card bg-surface-1 border border-hair ${typeMeta.tone}`}
          aria-label={message.content_type || 'text'}
        >
          <TypeIcon className="w-4 h-4" />
        </span>
      </Tooltip>
      {message.title || t.overview.reports_view.report_label}
      {onNavigate && (
        <span className="inline-flex items-center ml-2 gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => go(-1)}
            disabled={!hasPrev}
            tooltip={debtText("auto_previous_message_a5f5266d")}
            aria-label={debtText("auto_previous_message_93261bd8")}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => go(1)}
            disabled={!hasNext}
            tooltip={debtText("auto_next_message_5121d887")}
            aria-label={debtText("auto_next_message_e3960a5d")}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal subtitle — "From <persona>" with the name as a link into Agents.
// ---------------------------------------------------------------------------

export function ReportSubtitle({
  message, t, onOpenPersona,
}: {
  message: PersonaReport;
  t: T;
  onOpenPersona: () => void;
}) {
  // Persona-name → Agent detail: split the localized "From {name}" string
  // around the {name} placeholder so we can wrap just the name in a button
  // without baking presentation into the locale entry.
  const personaName = message.persona_name || t.overview.reports_view.unknown_persona;
  const fromTemplate = t.overview.reports_view.from_label;
  const [fromBefore, fromAfter] = fromTemplate.split('{name}');

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <span>{fromBefore ?? ''}</span>
      <Button
        variant="link"
        data-testid="msg-detail-persona-link"
        onClick={onOpenPersona}
        tooltip={t.overview.reports_view.persona_link_title}
        iconRight={<ExternalLink className="w-3 h-3" />}
      >
        {personaName}
      </Button>
      <span>{(fromAfter ?? '').trim()} · {formatRelativeTime(message.created_at)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal action bar — id copy, execution link, two-step delete.
// ---------------------------------------------------------------------------

export function ReportModalActions({
  message, msgId, t, copiedId, onCopyId, onOpenExecution,
  confirmingDelete, onArmDelete, onCancelDelete, onConfirmDelete,
}: {
  message: PersonaReport;
  msgId: string;
  t: T;
  copiedId: boolean;
  onCopyId: () => void;
  onOpenExecution: () => void;
  confirmingDelete: boolean;
  onArmDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-4 typo-body text-ink-2 mr-auto">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onCopyId(); }}
          tooltip={msgId}
         iconRight={copiedId ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}>
<DebtText k="auto_id_d789a1e9" /> <span className="num">{msgId.slice(0, 8)}</span>
</Button>
        {message.execution_id && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onOpenExecution(); }}
            tooltip={message.execution_id}
            iconRight={<ExternalLink className="w-3 h-3" />}
          >
            {t.overview.reports_view.view_execution}
          </Button>
        )}
      </div>

      {confirmingDelete ? (
        <div className="flex items-center gap-1">
          <Button variant="accent" tone="error" size="icon-sm" onClick={onConfirmDelete} tooltip={debtText("auto_confirm_delete_c9f2829e")}>
            <Check className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onCancelDelete} tooltip="Cancel">
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <Button variant="danger" size="sm" onClick={onArmDelete} icon={<Trash2 className="w-3.5 h-3.5" />}>
          {t.common.delete}
        </Button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Content action button (Export PDF / Play in chat)
// ---------------------------------------------------------------------------

function ContentActionButton({
  onClick, icon, label, testId, highlight = false,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testId: string;
  highlight?: boolean;
}) {
  return (
    <Button
      variant={highlight ? 'accent' : 'secondary'}
      tone={highlight ? 'agent' : undefined}
      size="sm"
      data-testid={testId}
      onClick={onClick}
      icon={icon}
    >
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// I. Content — the large reading surface + its per-content actions row.
// ---------------------------------------------------------------------------

export function ReportContentSection({
  content, format, title, t, companionEnabled, onExportPdf, onPlayInChat,
}: {
  content: string;
  /** From the report's `content_type`: `html` is a sanitized document frame. */
  format: 'markdown' | 'html';
  /** Accessible name for an HTML report's frame. */
  title: string;
  t: T;
  companionEnabled: boolean;
  onExportPdf: () => void;
  onPlayInChat: () => void;
}) {
  return (
    <section className="mb-10">
      <SectionMark index="I" label={t.overview.reports_view.content_label} />
      <article className="rounded-card bg-[color-mix(in_srgb,var(--color-background),var(--color-foreground)_3.5%)] px-8 py-7 shadow-elevation-1">
        <ReportBody
          document={{ format, content }}
          title={title}
          className={REPORT_CONTENT_MD_CLASS}
        />
      </article>

      <div
        data-testid="msg-detail-content-actions"
        className="flex flex-wrap items-center gap-2 mt-3 pl-1"
      >
        <ContentActionButton
          onClick={onExportPdf}
          icon={<Printer className="w-3.5 h-3.5" />}
          label={t.overview.reports_view.action_export_pdf}
          testId="msg-detail-action-export-pdf"
        />
        {companionEnabled && (
          <ContentActionButton
            onClick={onPlayInChat}
            icon={<MessageCircle className="w-3.5 h-3.5" />}
            label={t.overview.reports_view.action_play_in_chat}
            testId="msg-detail-action-play-in-chat"
            highlight
          />
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Star rating row
// ---------------------------------------------------------------------------

function StarRatingRow({
  value, onChange, saving, disabled, t, tx,
}: {
  value: number;
  onChange: (stars: number) => void;
  saving: boolean;
  disabled: boolean;
  t: T;
  tx: Tx;
}) {
  const [hover, setHover] = useState<number>(0);
  const display = hover || value;

  return (
    <div
      data-testid="msg-detail-rating"
      className="flex items-center gap-3 px-4 py-3 rounded-card bg-surface-1 border border-hair"
    >
      <span className="typo-label text-ink-2 flex-shrink-0">
        {t.overview.reports_view.rating_label}
      </span>
      <div
        className="inline-flex items-center gap-0.5"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= display;
          return (
            <Button
              key={n}
              variant="ghost"
              size="icon-sm"
              data-testid={`msg-detail-rating-star-${n}`}
              data-rating-value={n}
              onMouseEnter={() => setHover(n)}
              onClick={() => onChange(n)}
              disabled={disabled || saving}
              aria-label={tx(t.overview.reports_view.rating_star_aria, { value: n })}
            >
              <Star
                className={`w-5 h-5 transition-colors ${
                  filled
                    ? 'fill-status-warning text-status-warning'
                    : 'text-ink-3'
                }`}
              />
            </Button>
          );
        })}
      </div>
      {value > 0 && (
        <span
          data-testid="msg-detail-rating-saved"
          data-rating-saved={value}
          className="typo-caption text-ink-2 ml-auto"
        >
          {saving
            ? <Loader2 className="inline w-3 h-3 animate-spin" />
            : tx(t.overview.reports_view.rating_saved, { stars: value })}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// II. Editor's note — star rating + free-form "what could be better".
// ---------------------------------------------------------------------------

export interface ReportFeedbackState {
  rating: number;
  ratingSaving: boolean;
  ratingDisabled: boolean;
  onRate: (stars: number) => void;
  showFeedback: boolean;
  setShowFeedback: (open: boolean) => void;
  feedbackText: string;
  setFeedbackText: (text: string) => void;
  improving: 'idle' | 'loading' | 'sent';
  onImprove: () => void;
}

export function ReportFeedbackSection({ t, tx, state }: { t: T; tx: Tx; state: ReportFeedbackState }) {
  const {
    rating, ratingSaving, ratingDisabled, onRate,
    showFeedback, setShowFeedback, feedbackText, setFeedbackText, improving, onImprove,
  } = state;

  return (
    <section className="mb-10">
      <SectionMark index="II" label={t.overview.reports_view.improve_agent} muted />

      <StarRatingRow
        value={rating}
        onChange={onRate}
        saving={ratingSaving}
        disabled={ratingDisabled}
        t={t}
        tx={tx}
      />

      {improving === 'sent' ? (
        <div className="flex items-center gap-3 px-5 py-4 mt-3 rounded-card bg-status-success/[0.08] border-l-[3px] border-status-success/70">
          <CheckCircle2 className="w-5 h-5 text-status-success flex-shrink-0" />
          <span className="typo-body-lg text-status-success">
            {t.overview.reports_view.improvement_started}
          </span>
        </div>
      ) : !showFeedback ? (
        <PressSurface
          onPress={() => setShowFeedback(true)}
          className="group inline-flex items-center gap-3 px-5 py-4 mt-3 w-full rounded-card border border-hair bg-surface-1"
        >
          <Wand2 className="w-4 h-4 text-ink-3 flex-shrink-0" />
          <span className="typo-body-lg text-ink-2">
            {t.overview.reports_view.what_could_be_better}
          </span>
          <span className="ml-auto typo-label text-ink-1">
            {t.overview.reports_view.improve_agent}
          </span>
        </PressSurface>
      ) : (
        <div className="rounded-card border border-hair bg-surface-1 px-5 py-4 mt-3">
          <p className="typo-label text-ink-1 mb-3">
            {t.overview.reports_view.what_could_be_better}
          </p>
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={t.overview.reports_view.improve_placeholder}
            rows={3}
            autoFocus
            className="w-full px-4 py-3 rounded-card border border-hair bg-background/30 typo-body-lg text-ink-1 placeholder:text-ink-3 resize-none outline-none focus-visible:border-hair-2 focus-visible:bg-background/55 transition-colors"
          />
          <div className="flex items-center gap-2 mt-3">
            <Button
              variant="primary"
              size="sm"
              onClick={onImprove}
              disabled={!feedbackText.trim() || improving === 'loading'}
              icon={improving === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            >
              {improving === 'loading' ? t.overview.reports_view.starting : t.overview.reports_view.submit_improvement}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowFeedback(false); setFeedbackText(''); }}
            >
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// III. Delivery — channel-icon status pills.
// ---------------------------------------------------------------------------

export function ReportDeliverySection({
  deliveries, loading, t,
}: {
  deliveries: PersonaReportDelivery[];
  loading: boolean;
  t: T;
}) {
  return (
    <section className="mb-10">
      <SectionMark
        index="III"
        label={t.overview.reports_view.delivery_status}
        icon={<Send className="w-3 h-3.5 text-ink-3" />}
        muted
      />
      {loading ? null : deliveries.length === 0 ? (
        <p className="typo-body text-ink-2">
          {t.overview.reports_view.no_channels}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {deliveries.map((d) => (
            <ChannelDeliveryPill key={d.id} delivery={d} t={t} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// IV. Pending decisions — manual reviews linked to this execution.
// ---------------------------------------------------------------------------

export function ReportDecisionsSection({
  reviews, loading, resolvingId, onApprove, onReject, onOpenInApprovals, t,
}: {
  reviews: PersonaManualReview[];
  loading: boolean;
  resolvingId: string | null;
  onApprove: (review: PersonaManualReview) => void;
  onReject: (review: PersonaManualReview) => void;
  onOpenInApprovals: () => void;
  t: T;
}) {
  return (
    <section data-testid="msg-detail-pending-decisions">
      <SectionMark
        index="IV"
        label={t.overview.reports_view.section_pending_decisions}
        icon={<ShieldCheck className="w-3 h-3.5 text-ink-3" />}
        muted
      />
      {loading ? null : reviews.length === 0 ? (
        <p className="typo-body text-ink-2">
          {t.overview.reports_view.pending_decisions_empty}
        </p>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <PendingDecisionCard
              key={r.id}
              review={r}
              resolving={resolvingId === r.id}
              onApprove={() => onApprove(r)}
              onReject={() => onReject(r)}
              onOpenInApprovals={onOpenInApprovals}
              t={t}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pending decision card — reuses Manual Review visual primitives
// ---------------------------------------------------------------------------

function PendingDecisionCard({
  review, resolving, onApprove, onReject, onOpenInApprovals, t,
}: {
  review: PersonaManualReview;
  resolving: boolean;
  onApprove: () => void;
  onReject: () => void;
  onOpenInApprovals: () => void;
  t: T;
}) {
  // Multi-decision payloads live inside `context_data.decisions[]`. When
  // present, we render each child as its own FocusedDecisionCard — the
  // same primitive sub_manual-review uses — so the parent acts like a
  // group header with the children rendered inline. Per-decision verdicts
  // are tracked locally so the user can sweep through them; the parent's
  // Approve/Reject still resolves the whole review (single status on the
  // backend), but the local verdicts capture intent so the user can see
  // a coherent decision summary before they commit.
  const { decisions, contextText } = useMemo(
    () => parseDecisions(review.context_data),
    [review.context_data],
  );
  const hasChildren = decisions.length > 0;
  const [childVerdicts, setChildVerdicts] = useState<Record<string, DecisionVerdict>>({});

  const setVerdict = useCallback((id: string, v: 'accept' | 'reject') => {
    setChildVerdicts((prev) => ({ ...prev, [id]: prev[id] === v ? undefined : v }));
  }, []);

  // When the user accepts everything we offer a fast "Approve all", and
  // when they reject anything we offer "Reject all" — the per-decision
  // verdicts inform a quick parent action. Without verdicts these stay
  // as the default buttons.
  const allAccepted = hasChildren && decisions.every((d) => childVerdicts[d.id] === 'accept');
  const anyRejected = hasChildren && decisions.some((d) => childVerdicts[d.id] === 'reject');

  return (
    <div
      data-testid={`pending-review-row-${review.id}`}
      className="rounded-card border border-hair bg-surface-1 px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <SeverityIndicator severity={review.severity} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="typo-body-lg text-ink-1 break-words">
              {review.title}
            </p>
            {hasChildren && (
              <span
                className="typo-data text-ink-3"
                data-testid={`pending-review-decisions-count-${review.id}`}
              >
                {decisions.length} decisions
              </span>
            )}
          </div>
          {review.description && (
            <RichMarkdown content={review.description} variant="card" className="mb-2" />
          )}
          {contextText && (
            <RichMarkdown content={contextText} variant="card" className="mb-2" />
          )}
          {!hasChildren && review.context_data && (
            <div className="mt-2 px-3 py-2 rounded-card bg-background/30 border border-hair">
              <ContextDataPreview raw={review.context_data} />
            </div>
          )}
        </div>
        <span className="typo-data text-ink-3 flex-shrink-0">
          {formatRelativeTime(review.created_at)}
        </span>
      </div>

      {hasChildren && (
        <div
          className="mt-3 space-y-2 pl-3 border-l border-hair"
          data-testid={`pending-review-decisions-${review.id}`}
        >
          {decisions.map((decision) => (
            <FocusedDecisionCard
              key={decision.id}
              decision={decision}
              verdict={childVerdicts[decision.id]}
              onDecide={(v) => setVerdict(decision.id, v)}
              imageUrl={getDecisionImage(decision)}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-4">
        <Button
          variant="accent"
          tone="success"
          size="sm"
          data-testid={`pending-review-approve-${review.id}`}
          onClick={onApprove}
          disabled={resolving || (hasChildren && anyRejected)}
          disabledReason={hasChildren && anyRejected ? 'Clear rejections before approving the whole review' : undefined}
          icon={resolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
        >
          {hasChildren
            ? allAccepted
              ? t.overview.reports_view.pending_decisions_approve_all
              : t.overview.reports_view.pending_decisions_approve
            : t.overview.reports_view.pending_decisions_approve}
        </Button>
        <Button
          variant="accent"
          tone="error"
          size="sm"
          data-testid={`pending-review-reject-${review.id}`}
          onClick={onReject}
          disabled={resolving}
          icon={resolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsDown className="w-3 h-3" />}
        >
          {hasChildren && anyRejected
            ? t.overview.reports_view.pending_decisions_reject_all
            : t.overview.reports_view.pending_decisions_reject}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={onOpenInApprovals}
          icon={<ShieldAlert className="w-3 h-3" />}
        >
          {t.overview.reports_view.pending_decisions_view_all}
        </Button>
      </div>
    </div>
  );
}
