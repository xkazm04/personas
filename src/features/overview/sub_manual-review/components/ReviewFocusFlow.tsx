import { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  X,
  Clock,
  Zap,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { EmptyStateVariantHost } from '@/features/overview/shared/emptyStatePrototype';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { ContextDataPreview } from './ReviewListItem';
import { parseSuggestedActions, stripPersonaPrefix } from '../libs/reviewHelpers';
import {
  type TriageReview,
  type DecisionVerdict,
  type ActionType,
  parseDecisions,
  getDecisionImage,
  isVideoUrl,
  getSevCfg,
  sevDot,
  SEV_BADGE_COLORS,
  cardVariants,
  decisionVariants,
} from './reviewFocusHelpers';
import { FocusedDecisionCard } from './FocusedDecisionCard';
import { ActionZone } from './ActionZone';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText } from '@/i18n/DebtText';


// ---------------------------------------------------------------------------
// Severity badge (local — only used in this view)
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = getSevCfg(severity);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full typo-caption font-medium border ${SEV_BADGE_COLORS[severity] ?? SEV_BADGE_COLORS.info!}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReviewFocusFlowProps {
  reviews: TriageReview[];
  onApprove: (id: string, notes?: string) => void;
  onReject: (id: string, notes?: string) => void;
  isProcessing: boolean;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReviewFocusFlow({ reviews, onApprove, onReject, isProcessing }: ReviewFocusFlowProps) {
  const { t } = useTranslation();
  const pending = useMemo(() => reviews.filter((r) => r.status === 'pending'), [reviews]);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [reviewDir, setReviewDir] = useState(0);
  const [decisionIdx, setDecisionIdx] = useState(0);
  const [decisionDir, setDecisionDir] = useState(0);
  const [activeAction, setActiveAction] = useState<ActionType>(null);
  const [actionNotes, setActionNotes] = useState('');
  const [decisionVerdicts, setDecisionVerdicts] = useState<Record<string, DecisionVerdict>>({});

  // Keep index in bounds
  useEffect(() => {
    if (reviewIdx >= pending.length && pending.length > 0) setReviewIdx(pending.length - 1);
  }, [pending.length, reviewIdx]);

  const resetAction = useCallback(() => { setActiveAction(null); setActionNotes(''); }, []);

  // Reset when review changes
  useEffect(() => {
    setDecisionVerdicts({});
    setDecisionIdx(0);
    resetAction();
  }, [reviewIdx, resetAction]);

  const current = pending[reviewIdx] ?? null;
  const { decisions, galleryImage, contextText } = current
    ? parseDecisions(current.context_data)
    : { decisions: [], galleryImage: null, contextText: null };
  const hasDecisions = decisions.length > 0;
  const hasMultipleDecisions = decisions.length > 1;
  const currentDecision = hasDecisions ? decisions[decisionIdx] : null;
  const currentDecisionImage = currentDecision ? getDecisionImage(currentDecision) : null;
  const hasAnyImages = galleryImage || decisions.some((d) => getDecisionImage(d));

  // Suggested actions — surface them in both single- and multi-decision
  // modes. In multi-decision mode they read as hints for what the user is
  // judging across the batch, not per-decision actions.
  const suggestedActions = useMemo(
    () => (current ? parseSuggestedActions(current.suggested_actions) : []),
    [current],
  );

  // Navigation — reviews
  const goNextReview = useCallback(() => {
    if (reviewIdx < pending.length - 1) { setReviewDir(1); setReviewIdx((i) => i + 1); }
  }, [reviewIdx, pending.length]);

  const goPrevReview = useCallback(() => {
    if (reviewIdx > 0) { setReviewDir(-1); setReviewIdx((i) => i - 1); }
  }, [reviewIdx]);

  // Navigation — decisions
  const goNextDecision = useCallback(() => {
    if (decisionIdx < decisions.length - 1) { setDecisionDir(1); setDecisionIdx((i) => i + 1); }
  }, [decisionIdx, decisions.length]);

  const goPrevDecision = useCallback(() => {
    if (decisionIdx > 0) { setDecisionDir(-1); setDecisionIdx((i) => i - 1); }
  }, [decisionIdx]);

  // Build verdict notes for an arbitrary verdict map — used both by the
  // bottom Accept-all / Reject-all flow (current state) and the per-decision
  // auto-resolve flow (next state, before React commits).
  const buildVerdictNotes = useCallback((verdicts: Record<string, DecisionVerdict>, extraText: string, prefix?: string) => {
    const parts: string[] = [];
    if (prefix) parts.push(prefix);
    if (hasDecisions) {
      const entries = Object.entries(verdicts).filter(([, v]) => v != null);
      if (entries.length > 0) {
        const formatted = entries.map(([id, v]) => {
          const d = decisions.find((dd) => dd.id === id);
          return `${v === 'accept' ? '+' : '-'} ${d?.label ?? id}`;
        }).join('\n');
        parts.push(`Decisions:\n${formatted}`);
      }
    }
    if (extraText.trim()) parts.push(extraText.trim());
    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }, [hasDecisions, decisions]);

  const buildNotes = useCallback((extraText: string, prefix?: string) => {
    return buildVerdictNotes(decisionVerdicts, extraText, prefix);
  }, [buildVerdictNotes, decisionVerdicts]);

  const setAllDecisions = useCallback((verdict: DecisionVerdict) => {
    const next: Record<string, DecisionVerdict> = {};
    decisions.forEach((d) => { next[d.id] = verdict; });
    setDecisionVerdicts(next);
  }, [decisions]);

  // Per-decision verdict + auto-advance. Records the verdict and either
  // moves to the next undecided decision or, when the last one is now
  // resolved, commits the parent review (any-accepted → approved, all-
  // rejected → rejected). The individual verdicts are preserved in notes.
  const decideAndAdvance = useCallback((decisionId: string, verdict: 'accept' | 'reject') => {
    if (!current || isProcessing) return;
    const nextVerdicts: Record<string, DecisionVerdict> = { ...decisionVerdicts, [decisionId]: verdict };
    setDecisionVerdicts(nextVerdicts);

    const allDecided = decisions.every((d) => nextVerdicts[d.id] != null);
    if (allDecided) {
      const notes = buildVerdictNotes(nextVerdicts, '');
      const anyAccepted = decisions.some((d) => nextVerdicts[d.id] === 'accept');
      if (anyAccepted) onApprove(current.id, notes);
      else onReject(current.id, notes);
      return;
    }

    // Find next undecided decision starting after the current index.
    const total = decisions.length;
    for (let step = 1; step <= total; step++) {
      const candidate = (decisionIdx + step) % total;
      if (nextVerdicts[decisions[candidate]!.id] == null) {
        setDecisionDir(candidate > decisionIdx ? 1 : -1);
        setDecisionIdx(candidate);
        return;
      }
    }
  }, [current, isProcessing, decisions, decisionIdx, decisionVerdicts, buildVerdictNotes, onApprove, onReject]);

  // Actions
  const handleConfirmAction = useCallback(() => {
    if (!current || isProcessing) return;
    if (activeAction === 'approve') onApprove(current.id, buildNotes(actionNotes));
    else if (activeAction === 'reject') onReject(current.id, buildNotes(actionNotes));
    else if (activeAction === 'retry') onReject(current.id, buildNotes(actionNotes, '[RETRY]'));
    resetAction();
  }, [current, isProcessing, activeAction, actionNotes, onApprove, onReject, buildNotes, resetAction]);

  // Keyboard — with multiple decisions, arrow keys triage the CURRENT decision
  // instead of firing the review-wide action. The review-wide "Accept all" /
  // "Reject all" lives on the bottom button bar in that mode.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (isProcessing) return;

      const multiDecisionMode = hasMultipleDecisions && !!currentDecision && activeAction === null;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (multiDecisionMode) {
          decideAndAdvance(currentDecision!.id, 'accept');
        } else if (activeAction === 'approve') {
          handleConfirmAction();
        } else {
          setActiveAction('approve');
          setActionNotes('');
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (multiDecisionMode) {
          decideAndAdvance(currentDecision!.id, 'reject');
        } else if (activeAction === 'reject') {
          handleConfirmAction();
        } else {
          setActiveAction('reject');
          setActionNotes('');
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (activeAction === 'retry') handleConfirmAction();
        else { setActiveAction('retry'); setActionNotes(''); }
      } else if (e.key === 'Escape') {
        resetAction();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isProcessing, activeAction, handleConfirmAction, resetAction, hasMultipleDecisions, currentDecision, decideAndAdvance]);

  // Decision summary counts
  const acceptCount = Object.values(decisionVerdicts).filter((v) => v === 'accept').length;
  const rejectCount = Object.values(decisionVerdicts).filter((v) => v === 'reject').length;
  const undecidedCount = decisions.length - acceptCount - rejectCount;

  // Severity counts for queue header
  const sevCounts = useMemo(() => {
    const c = { critical: 0, warning: 0, info: 0 };
    for (const r of pending) {
      if (r.severity === 'critical') c.critical++;
      else if (r.severity === 'warning' || r.severity === 'high') c.warning++;
      else c.info++;
    }
    return c;
  }, [pending]);

  const selectReview = useCallback((idx: number) => {
    setReviewDir(idx > reviewIdx ? 1 : -1);
    setReviewIdx(idx);
  }, [reviewIdx]);

  // -----------------------------------------------------------------------
  // Empty state
  // -----------------------------------------------------------------------
  if (pending.length === 0) {
    return (
      <div className="flex items-center justify-center h-full py-12">
        <EmptyStateVariantHost
          motif="approval"
          content={{
            icon: Check,
            title: t.overview.review_focus.all_caught_up,
            subtitle: t.overview.review_focus.no_pending,
          }}
        />
      </div>
    );
  }

  const sevCfg = getSevCfg(current!.severity);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ---- Queue Sidebar ---- */}
      <div className="w-[220px] flex-shrink-0 border-r border-primary/10 bg-secondary/20 flex flex-col">
        <div className="px-3 py-2.5 border-b border-primary/10 flex items-center justify-between">
          <span className="typo-label font-semibold text-foreground uppercase tracking-wider">{t.overview.review_focus.queue} ({pending.length})</span>
          <div className="flex items-center gap-1.5">
            {sevCounts.critical > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="typo-caption text-red-400">{sevCounts.critical}</span>
              </span>
            )}
            {sevCounts.warning > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="typo-caption text-amber-400">{sevCounts.warning}</span>
              </span>
            )}
            {sevCounts.info > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="typo-caption text-blue-400">{sevCounts.info}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {pending.map((r, i) => {
            const isActive = i === reviewIdx;
            return (
              <button
                key={r.id}
                onClick={() => selectReview(i)}
                className={`w-full text-left px-3 py-2.5 transition-colors border-l-2 ${isActive ? 'border-l-primary bg-primary/8' : 'border-l-transparent hover:bg-secondary/30'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sevDot(r.severity)}`} />
                  <span className={`typo-caption truncate ${isActive ? 'text-foreground font-medium' : 'text-foreground'}`}>
                    {stripPersonaPrefix(r.title, r.persona_name)}
                  </span>
                </div>
                {r.persona_name && (
                  <span className="typo-caption text-foreground ml-4 block truncate mt-0.5">{r.persona_name}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Main Content ---- */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top nav bar */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-2 border-b border-primary/10 bg-background/80 backdrop-blur-sm">
          <span className="typo-body font-medium text-foreground">Review {reviewIdx + 1} of {pending.length}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={goPrevReview} disabled={reviewIdx === 0}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={goNextReview} disabled={reviewIdx >= pending.length - 1}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Scrollable review area */}
        <div className="flex-1 flex items-start justify-center overflow-y-auto py-6 px-4">
          <AnimatePresence mode="wait" custom={reviewDir}>
            <motion.div
              key={current!.id}
              custom={reviewDir}
              variants={cardVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className={`w-full ${hasAnyImages ? 'max-w-5xl' : 'max-w-3xl'}`}
            >
              <div className={`rounded-modal border border-primary/10 ring-1 ${sevCfg.ring} overflow-hidden`} style={{ boxShadow: sevCfg.shadow }}>
                {/* Severity gradient top bar */}
                <div className={`h-0.5 bg-gradient-to-r ${sevCfg.gradient}`} />

                <div className="p-5 space-y-4">
                  {/* Header */}
                  <div className="flex items-start gap-3">
                    <PersonaIcon icon={current!.persona_icon ?? null} color={current!.persona_color ?? null} display="framed" frameSize={"lg"} />
                    <span className="typo-body font-medium text-foreground mt-1">{current!.persona_name || 'Unknown'}</span>
                    <div className="mt-1"><SeverityBadge severity={current!.severity} /></div>
                    <div className="ml-auto flex flex-col items-end gap-1">
                      {hasMultipleDecisions && (
                        <div className="flex items-center gap-2">
                          <span className="typo-label font-semibold uppercase tracking-wider text-foreground">
                            Decision {decisionIdx + 1} of {decisions.length}
                          </span>
                          <Button variant="ghost" size="icon-sm" onClick={goPrevDecision} disabled={decisionIdx === 0}>
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </Button>
                          <div className="flex items-center gap-1">
                            {decisions.map((d, i) => {
                              const v = decisionVerdicts[d.id];
                              const dotColor = v === 'accept' ? 'bg-emerald-400' : v === 'reject' ? 'bg-red-400' : i === decisionIdx ? 'bg-primary' : 'bg-foreground/20';
                              return (
                                <button
                                  key={d.id}
                                  onClick={() => { setDecisionDir(i > decisionIdx ? 1 : -1); setDecisionIdx(i); }}
                                  className={`w-2 h-2 rounded-full transition-all ${dotColor} ${i === decisionIdx ? 'scale-125' : ''}`}
                                />
                              );
                            })}
                          </div>
                          <Button variant="ghost" size="icon-sm" onClick={goNextDecision} disabled={decisionIdx >= decisions.length - 1}>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </Button>
                          {(acceptCount > 0 || rejectCount > 0) && (
                            <button
                              onClick={() => setDecisionVerdicts({})}
                              className="typo-caption text-foreground hover:text-foreground/80 transition-colors"
                              title={t.overview.review_focus.clear_all_verdicts}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      )}
                      <span className="flex items-center gap-1 typo-caption text-foreground">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(current!.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* Title */}
                  <h2 className="typo-heading-lg font-bold text-foreground leading-tight">{stripPersonaPrefix(current!.title, current!.persona_name)}</h2>

                  {/* Description */}
                  {current!.description && (
                    <p className="typo-body text-foreground/90 leading-relaxed whitespace-pre-wrap">{current!.description}</p>
                  )}

                  {/* Extra prose context preserved by the backend when
                      decisions are present — gives the user more than just
                      bare decision labels. */}
                  {contextText && (
                    <p className="typo-body text-foreground leading-relaxed whitespace-pre-wrap">{contextText}</p>
                  )}

                  {/* Gallery-level media (single image/video review like art director) */}
                  {galleryImage && !hasDecisions && (
                    <>
                      <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
                      <div className="rounded-card overflow-hidden border border-primary/10 bg-black/20">
                        {isVideoUrl(galleryImage) ? (
                          <video
                            src={galleryImage}
                            controls
                            className="w-full max-h-[50vh] object-contain"
                          >
                            <DebtText k="auto_your_browser_does_not_support_video_playba_8f8c2d0d" />
                          </video>
                        ) : (
                          <img
                            src={galleryImage}
                            alt={stripPersonaPrefix(current!.title, current!.persona_name)}
                            className="w-full max-h-[50vh] object-contain"
                            loading="lazy"
                          />
                        )}
                      </div>
                    </>
                  )}

                  {/* Decorative divider */}
                  <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

                  {/* ---- Decision content ---- */}
                  {hasDecisions && (
                    <div className="space-y-3">
                      {/* Focused decision card — one at a time */}
                      <AnimatePresence mode="wait" custom={decisionDir}>
                        {currentDecision && (
                          <motion.div
                            key={currentDecision.id}
                            custom={decisionDir}
                            variants={decisionVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                          >
                            <FocusedDecisionCard
                              decision={currentDecision}
                              verdict={decisionVerdicts[currentDecision.id]}
                              onDecide={(v) => decideAndAdvance(currentDecision.id, v)}
                              imageUrl={currentDecisionImage}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Summary strip */}
                      {decisions.length > 0 && (acceptCount > 0 || rejectCount > 0) && (
                        <div className="flex items-center gap-3 typo-caption">
                          {acceptCount > 0 && <span className="text-emerald-400">{acceptCount} accepted</span>}
                          {rejectCount > 0 && <span className="text-red-400">{rejectCount} rejected</span>}
                          {undecidedCount > 0 && <span className="text-foreground">{undecidedCount} undecided</span>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Context fallback (no decisions) */}
                  {!hasDecisions && !galleryImage && <ContextDataPreview raw={current!.context_data} />}

                  {/* Suggested actions */}
                  {suggestedActions.length > 0 && (
                    <>
                      <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 typo-body text-foreground">
                          <Zap className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="font-medium">{t.overview.review_focus.quick_actions}</span>
                        </div>
                        {suggestedActions.map((action, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              setActiveAction('approve');
                              setActionNotes(action);
                            }}
                            className="flex items-center gap-2 px-3 py-2 rounded-card typo-body text-foreground bg-primary/5 border border-primary/10 hover:bg-primary/10 hover:border-primary/20 transition-colors text-left"
                          >
                            <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center typo-heading font-bold flex-shrink-0">{i + 1}</span>
                            {action}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* ---- Bottom Action Bar ---- */}
                <div className="border-t border-primary/10">
                  <div className="grid grid-cols-3 divide-x divide-primary/10">
                    <ActionZone
                      active={activeAction === 'reject'}
                      onClick={() => {
                        if (activeAction === 'reject') { setActiveAction(null); return; }
                        if (hasMultipleDecisions) setAllDecisions('reject');
                        setActiveAction('reject');
                        setActionNotes('');
                      }}
                      icon={<X className="w-5 h-5" />}
                      label={hasMultipleDecisions ? t.overview.review_focus.reject_all : t.overview.review.reject}
                      colorClasses="text-red-400 hover:bg-red-500/10"
                      activeClasses="bg-red-500/10"
                      notes={actionNotes}
                      onNotesChange={setActionNotes}
                      onConfirm={handleConfirmAction}
                      isProcessing={isProcessing}
                      confirmColor="bg-red-500/20 hover:bg-red-500/30 text-red-400"
                    />
                    <ActionZone
                      active={activeAction === 'retry'}
                      onClick={() => { setActiveAction(activeAction === 'retry' ? null : 'retry'); setActionNotes(''); }}
                      icon={<RotateCcw className="w-5 h-5" />}
                      label={t.overview.review_focus.retry_with_changes}
                      colorClasses="text-amber-400 hover:bg-amber-500/10"
                      activeClasses="bg-amber-500/10"
                      notes={actionNotes}
                      onNotesChange={setActionNotes}
                      onConfirm={handleConfirmAction}
                      isProcessing={isProcessing}
                      confirmColor="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400"
                    />
                    <ActionZone
                      active={activeAction === 'approve'}
                      onClick={() => {
                        if (activeAction === 'approve') { setActiveAction(null); return; }
                        if (hasMultipleDecisions) setAllDecisions('accept');
                        setActiveAction('approve');
                        setActionNotes('');
                      }}
                      icon={<Check className="w-5 h-5" />}
                      label={hasMultipleDecisions ? t.overview.review_focus.accept_all : t.overview.review.approve}
                      colorClasses="text-emerald-400 hover:bg-emerald-500/10"
                      activeClasses="bg-emerald-500/10"
                      notes={actionNotes}
                      onNotesChange={setActionNotes}
                      onConfirm={handleConfirmAction}
                      isProcessing={isProcessing}
                      confirmColor="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400"
                    />
                  </div>
                  <div className="text-center py-1.5 text-[11px] text-foreground border-t border-primary/5">
                    {hasMultipleDecisions ? (
                      <>
                        <kbd className="px-1 py-0.5 rounded bg-foreground/5 text-foreground font-mono">&#8592;</kbd> <DebtText k="auto_reject_this_0105a5cc" />
                        <span className="mx-2 text-foreground">|</span>
                        <kbd className="px-1 py-0.5 rounded bg-foreground/5 text-foreground font-mono">&#8595;</kbd> Retry
                        <span className="mx-2 text-foreground">|</span>
                        <kbd className="px-1 py-0.5 rounded bg-foreground/5 text-foreground font-mono">&#8594;</kbd> <DebtText k="auto_accept_this_d7066048" />
                      </>
                    ) : (
                      <>
                        <kbd className="px-1 py-0.5 rounded bg-foreground/5 text-foreground font-mono">&#8592;</kbd> Reject
                        <span className="mx-2 text-foreground">|</span>
                        <kbd className="px-1 py-0.5 rounded bg-foreground/5 text-foreground font-mono">&#8595;</kbd> Retry
                        <span className="mx-2 text-foreground">|</span>
                        <kbd className="px-1 py-0.5 rounded bg-foreground/5 text-foreground font-mono">&#8594;</kbd> Approve
                      </>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

