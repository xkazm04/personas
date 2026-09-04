import { useCallback, useMemo, useState } from 'react';
import {
  Send, Trash2, ExternalLink, Check, X, Copy, Wand2, Loader2, CheckCircle2,
  ChevronLeft, ChevronRight, Star, Printer, MessageCircle, ShieldCheck,
  ShieldAlert, ThumbsUp, ThumbsDown,
  FileText, Code2, AlertCircle, HelpCircle, Image as ImageIcon, MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
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
  text:     { icon: FileText,     tone: 'text-indigo-400' },
  markdown: { icon: FileText,     tone: 'text-indigo-400' },
  code:     { icon: Code2,        tone: 'text-violet-400' },
  alert:    { icon: AlertCircle,  tone: 'text-red-400' },
  error:    { icon: AlertCircle,  tone: 'text-red-400' },
  question: { icon: HelpCircle,   tone: 'text-amber-400' },
  image:    { icon: ImageIcon,    tone: 'text-emerald-400' },
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
 * The `[&_h1]:typo-heading-lg` / `[&_h2]:typo-heading` entries are kept
 * verbatim and are deliberately inert: a `typo-*` token cannot be delivered
 * through an arbitrary variant at all (see markdownVariants.ts), and the
 * `font-semibold` beside each is a no-op the census counts
 * (`typo-token-overpainted`). Deleting them is a real fix that DROPS two
 * counted violations, and a drop has to be ratcheted with
 * `npm run census -- --update` rather than smuggled in. The `document` variant
 * now delivers what these two lines were asking for, on the element itself.
 */
const REPORT_CONTENT_MD_CLASS = [
  'typo-body-lg leading-[1.8] text-foreground',
  '[&_p]:mb-5 [&_p:last-child]:mb-0',
  '[&_p:first-of-type:first-letter]:float-left',
  '[&_p:first-of-type:first-letter]:typo-heading-lg',
  '[&_p:first-of-type:first-letter]:leading-[0.9]',
  '[&_p:first-of-type:first-letter]:font-semibold',
  '[&_p:first-of-type:first-letter]:text-foreground/45',
  '[&_p:first-of-type:first-letter]:pr-2',
  '[&_p:first-of-type:first-letter]:pt-1',
  '[&_p:first-of-type:first-letter]:font-serif',
  '[&_h1]:mt-0 [&_h1]:typo-heading-lg [&_h1]:font-semibold [&_h1]:text-foreground',
  '[&_h2]:mt-7 [&_h2]:typo-heading [&_h2]:font-semibold [&_h2]:text-foreground',
  '[&_pre]:my-5 [&_pre]:rounded-2xl',
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
  const numeralTone = muted ? 'text-foreground' : 'text-primary/55';
  const labelTone   = muted ? 'text-foreground' : 'text-foreground';
  const ruleTone    = muted ? 'bg-foreground/10'   : 'bg-primary/20';
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <span className={`font-serif typo-heading-lg font-light leading-none ${numeralTone}`}>
        {index}
      </span>
      {icon}
      <span className={`typo-label ${labelTone}`}>
        {label}
      </span>
      <span className={`flex-1 h-px ${ruleTone}`} aria-hidden="true" />
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
    return CONTENT_TYPE_ICONS[key] ?? { icon: MessageSquare, tone: 'text-indigo-400' };
  }, [message.content_type]);
  const TypeIcon = typeMeta.icon;

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-flex items-center justify-center w-7 h-7 rounded-card bg-secondary/30 border border-primary/10 ${typeMeta.tone}`}
        title={message.content_type || 'text'}
        aria-label={message.content_type || 'text'}
      >
        <TypeIcon className="w-4 h-4" />
      </span>
      {message.title || t.overview.reports_view.report_label}
      {onNavigate && (
        <span className="inline-flex items-center ml-2 gap-0.5">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={!hasPrev}
            className="p-1 rounded-card text-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={debtText("auto_previous_message_a5f5266d")}
            aria-label={debtText("auto_previous_message_93261bd8")}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={!hasNext}
            className="p-1 rounded-card text-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={debtText("auto_next_message_5121d887")}
            aria-label={debtText("auto_next_message_e3960a5d")}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
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
      <button
        type="button"
        data-testid="msg-detail-persona-link"
        onClick={onOpenPersona}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 -mx-0.5 rounded-input typo-body font-medium text-primary hover:text-primary/80 hover:bg-primary/[0.08] transition-colors focus-ring"
        title={t.overview.reports_view.persona_link_title}
      >
        {personaName}
        <ExternalLink className="w-3 h-3 opacity-70" />
      </button>
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
      <div className="flex items-center gap-4 typo-body text-foreground mr-auto">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCopyId(); }}
          className="inline-flex items-center gap-1 hover:text-muted-foreground transition-colors"
          title={msgId}
        >
          <DebtText k="auto_id_d789a1e9" /> <span className="font-mono">{msgId.slice(0, 8)}</span>
          {copiedId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
        {message.execution_id && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenExecution(); }}
            className="inline-flex items-center gap-1 text-blue-400/70 hover:text-blue-400 transition-colors"
            title={message.execution_id}
          >
            {t.overview.reports_view.view_execution} <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>

      {confirmingDelete ? (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={onConfirmDelete} title={debtText("auto_confirm_delete_c9f2829e")} className="text-red-400 bg-red-500/15 hover:bg-red-500/25">
            <Check className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onCancelDelete} title="Cancel">
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onArmDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal typo-heading bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" /> {t.common.delete}
        </button>
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
  const baseCls =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption font-medium transition-colors';
  const toneCls = highlight
    ? 'text-primary bg-primary/[0.08] hover:bg-primary/[0.14] border border-primary/15'
    : 'text-foreground bg-secondary/[0.05] hover:bg-secondary/[0.1] border border-primary/10';
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`${baseCls} ${toneCls}`}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// I. Content — the large reading surface + its per-content actions row.
// ---------------------------------------------------------------------------

export function ReportContentSection({
  content, t, companionEnabled, onExportPdf, onPlayInChat,
}: {
  content: string;
  t: T;
  companionEnabled: boolean;
  onExportPdf: () => void;
  onPlayInChat: () => void;
}) {
  return (
    <section className="mb-10">
      <SectionMark index="I" label={t.overview.reports_view.content_label} />
      <article className="rounded-3xl bg-[color-mix(in_srgb,var(--color-background),var(--color-foreground)_3.5%)] px-8 py-7 shadow-elevation-1">
        <MarkdownRenderer
          content={content}
          variant="document"
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
      className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-secondary/[0.05] border border-primary/10"
    >
      <span className="typo-label text-foreground flex-shrink-0">
        {t.overview.reports_view.rating_label}
      </span>
      <div
        className="inline-flex items-center gap-0.5"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= display;
          return (
            <button
              key={n}
              type="button"
              data-testid={`msg-detail-rating-star-${n}`}
              data-rating-value={n}
              onMouseEnter={() => setHover(n)}
              onClick={() => onChange(n)}
              disabled={disabled || saving}
              aria-label={tx(t.overview.reports_view.rating_star_aria, { value: n })}
              className={`p-1 rounded-card transition-transform ${
                disabled ? 'cursor-not-allowed opacity-40' :
                saving ? 'cursor-wait' :
                'hover:scale-110'
              }`}
            >
              <Star
                className={`w-5 h-5 transition-colors ${
                  filled
                    ? 'fill-amber-400 text-amber-400'
                    : 'text-foreground'
                }`}
              />
            </button>
          );
        })}
      </div>
      {value > 0 && (
        <span
          data-testid="msg-detail-rating-saved"
          data-rating-saved={value}
          className="typo-caption text-foreground ml-auto"
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
        <div className="flex items-center gap-3 px-5 py-4 mt-3 rounded-2xl bg-emerald-500/[0.08] border-l-[3px] border-emerald-400/70">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <span className="typo-body-lg text-emerald-300 font-medium">
            {t.overview.reports_view.improvement_started}
          </span>
        </div>
      ) : !showFeedback ? (
        <button
          type="button"
          onClick={() => setShowFeedback(true)}
          className="group inline-flex items-center gap-3 px-5 py-4 mt-3 w-full text-left rounded-2xl border-l-[3px] border-amber-400/60 bg-amber-500/[0.05] hover:bg-amber-500/[0.08] transition-colors"
        >
          <Wand2 className="w-4 h-4 text-amber-400/85 flex-shrink-0 group-hover:text-amber-300 transition-colors" />
          <span className="typo-body-lg text-foreground/85 italic">
            {t.overview.reports_view.what_could_be_better}
          </span>
          <span className="ml-auto typo-label text-amber-400/75">
            {t.overview.reports_view.improve_agent}
          </span>
        </button>
      ) : (
        <div className="rounded-2xl border-l-[3px] border-amber-400/60 bg-amber-500/[0.05] px-5 py-4 mt-3">
          <p className="typo-label text-amber-300/85 mb-3">
            {t.overview.reports_view.what_could_be_better}
          </p>
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={t.overview.reports_view.improve_placeholder}
            rows={3}
            autoFocus
            className="w-full px-4 py-3 rounded-modal border border-amber-400/15 bg-background/30 typo-body-lg leading-relaxed text-foreground placeholder-foreground/35 resize-none outline-none focus-visible:border-amber-400/40 focus-visible:bg-background/55 transition-colors"
          />
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={onImprove}
              disabled={!feedbackText.trim() || improving === 'loading'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-card typo-caption font-semibold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 disabled:opacity-40 transition-colors"
            >
              {improving === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              {improving === 'loading' ? t.overview.reports_view.starting : t.overview.reports_view.submit_improvement}
            </button>
            <button
              type="button"
              onClick={() => { setShowFeedback(false); setFeedbackText(''); }}
              className="px-3 py-2 typo-caption text-foreground hover:text-foreground/85 transition-colors"
            >
              {t.common.cancel}
            </button>
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
        icon={<Send className="w-3 h-3.5 text-foreground" />}
        muted
      />
      {loading ? null : deliveries.length === 0 ? (
        <p className="typo-body text-foreground italic">
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
        icon={<ShieldCheck className="w-3 h-3.5 text-foreground" />}
        muted
      />
      {loading ? null : reviews.length === 0 ? (
        <p className="typo-body text-foreground italic">
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
      className="rounded-2xl border border-primary/10 bg-secondary/[0.04] px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <SeverityIndicator severity={review.severity} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="typo-body-lg font-medium text-foreground break-words">
              {review.title}
            </p>
            {hasChildren && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input typo-caption font-semibold text-primary/85 bg-primary/10 border border-primary/15"
                data-testid={`pending-review-decisions-count-${review.id}`}
              >
                {decisions.length} decisions
              </span>
            )}
          </div>
          {review.description && (
            <MarkdownRenderer content={review.description} variant="card" className="mb-2" />
          )}
          {contextText && (
            <MarkdownRenderer content={contextText} variant="card" className="mb-2" />
          )}
          {!hasChildren && review.context_data && (
            <div className="mt-2 px-3 py-2 rounded-card bg-background/30 border border-primary/[0.06]">
              <ContextDataPreview raw={review.context_data} />
            </div>
          )}
        </div>
        <span className="typo-caption text-foreground tabular-nums flex-shrink-0">
          {formatRelativeTime(review.created_at)}
        </span>
      </div>

      {hasChildren && (
        <div
          className="mt-3 space-y-2 pl-3 border-l border-primary/10"
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
        <button
          type="button"
          data-testid={`pending-review-approve-${review.id}`}
          onClick={onApprove}
          disabled={resolving || (hasChildren && anyRejected)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-card typo-caption font-semibold bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 transition-colors"
          title={hasChildren && anyRejected ? 'Clear rejections before approving the whole review' : undefined}
        >
          {resolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
          {hasChildren
            ? allAccepted
              ? t.overview.reports_view.pending_decisions_approve_all
              : t.overview.reports_view.pending_decisions_approve
            : t.overview.reports_view.pending_decisions_approve}
        </button>
        <button
          type="button"
          data-testid={`pending-review-reject-${review.id}`}
          onClick={onReject}
          disabled={resolving}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-card typo-caption font-semibold bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-40 transition-colors"
        >
          {resolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsDown className="w-3 h-3" />}
          {hasChildren && anyRejected
            ? t.overview.reports_view.pending_decisions_reject_all
            : t.overview.reports_view.pending_decisions_reject}
        </button>
        <button
          type="button"
          onClick={onOpenInApprovals}
          className="ml-auto inline-flex items-center gap-1 px-2.5 py-2 typo-caption text-foreground hover:text-foreground/85 transition-colors"
        >
          <ShieldAlert className="w-3 h-3" />
          {t.overview.reports_view.pending_decisions_view_all}
        </button>
      </div>
    </div>
  );
}
