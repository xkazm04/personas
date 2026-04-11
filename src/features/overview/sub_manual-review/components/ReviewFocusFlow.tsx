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
import { formatRelativeTime } from '@/lib/utils/formatters';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { ContextDataPreview } from './ReviewListItem';
import { parseSuggestedActions } from '../libs/reviewHelpers';
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

// ---------------------------------------------------------------------------
// Severity badge (local — only used in this view)
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = getSevCfg(severity);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${SEV_BADGE_COLORS[severity] ?? SEV_BADGE_COLORS.info!}`}>
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
  const { decisions, galleryImage } = current ? parseDecisions(current.context_data) : { decisions: [], galleryImage: null };
  const hasDecisions = decisions.length > 0;
  const hasMultipleDecisions = decisions.length > 1;
  const currentDecision = hasDecisions ? decisions[decisionIdx] : null;
  const currentDecisionImage = currentDecision ? getDecisionImage(currentDecision) : null;
  const hasAnyImages = galleryImage || decisions.some((d) => getDecisionImage(d));

  // Suggested actions (only when no decisions)
  const suggestedActions = useMemo(
    () => (current && !hasDecisions ? parseSuggestedActions(current.suggested_actions) : []),
    [current, hasDecisions],
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

  // Decision toggles
  const toggleDecision = useCallback((id: string, verdict: DecisionVerdict) => {
    setDecisionVerdicts((prev) => ({ ...prev, [id]: prev[id] === verdict ? undefined : verdict }));
  }, []);

  const setAllDecisions = useCallback((verdict: DecisionVerdict) => {
    const next: Record<string, DecisionVerdict> = {};
    decisions.forEach((d) => { next[d.id] = verdict; });
    setDecisionVerdicts(next);
  }, [decisions]);

  // Build notes
  const buildNotes = useCallback((extraText: string, prefix?: string) => {
    const parts: string[] = [];
    if (prefix) parts.push(prefix);
    if (hasDecisions) {
      const entries = Object.entries(decisionVerdicts).filter(([, v]) => v != null);
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
  }, [hasDecisions, decisions, decisionVerdicts]);

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
          // Accept current decision (force-set, don't toggle) and auto-advance
          setDecisionVerdicts((prev) => ({ ...prev, [currentDecision!.id]: 'accept' }));
          if (decisionIdx < decisions.length - 1) {
            setDecisionDir(1);
            setDecisionIdx((i) => i + 1);
          }
        } else if (activeAction === 'approve') {
          handleConfirmAction();
        } else {
          setActiveAction('approve');
          setActionNotes('');
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (multiDecisionMode) {
          // Reject current decision and auto-advance
          setDecisionVerdicts((prev) => ({ ...prev, [currentDecision!.id]: 'reject' }));
          if (decisionIdx < decisions.length - 1) {
            setDecisionDir(1);
            setDecisionIdx((i) => i + 1);
          }
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
  }, [isProcessing, activeAction, handleConfirmAction, resetAction, hasMultipleDecisions, currentDecision, decisionIdx, decisions.length]);

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
      <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <Check className="w-8 h-8 text-emerald-400" />
        </div>
        <p className="text-lg font-medium text-foreground">All caught up</p>
        <p className="text-sm text-foreground/60">No pending reviews to process.</p>
      </div>
    );
  }

  const sevCfg = getSevCfg(current!.severity);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ---- Queue Sidebar ---- */}
      <div className="w-[220px] flex-shrink-0 border-r border-primary/10 bg-secondary/20 flex flex-col">
        <div className="px-3 py-2.5 border-b border-primary/10 flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">Queue ({pending.length})</span>
          <div className="flex items-center gap-1.5">
            {sevCounts.critical > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-xs text-red-400">{sevCounts.critical}</span>
              </span>
            )}
            {sevCounts.warning > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-xs text-amber-400">{sevCounts.warning}</span>
              </span>
            )}
            {sevCounts.info > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-xs text-blue-400">{sevCounts.info}</span>
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
                  <span className={`text-xs truncate ${isActive ? 'text-foreground font-medium' : 'text-foreground/80'}`}>
                    {r.title}
                  </span>
                </div>
                {r.persona_name && (
                  <span className="text-xs text-foreground/50 ml-4 block truncate mt-0.5">{r.persona_name}</span>
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
          <span className="text-sm font-medium text-foreground/70">Review {reviewIdx + 1} of {pending.length}</span>
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
              <div className={`rounded-xl border border-primary/10 ring-1 ${sevCfg.ring} overflow-hidden`} style={{ boxShadow: sevCfg.shadow }}>
                {/* Severity gradient top bar */}
                <div className={`h-0.5 bg-gradient-to-r ${sevCfg.gradient}`} />

                <div className="p-5 space-y-4">
                  {/* Header */}
                  <div className="flex items-start gap-3">
                    <PersonaIcon icon={current!.persona_icon ?? null} color={current!.persona_color ?? null} display="framed" frameSize={"lg"} />
                    <span className="text-sm font-medium text-foreground/80 mt-1">{current!.persona_name || 'Unknown'}</span>
                    <div className="mt-1"><SeverityBadge severity={current!.severity} /></div>
                    <div className="ml-auto flex flex-col items-end gap-1">
                      {hasMultipleDecisions && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wider text-foreground/60">
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
                              className="text-xs text-foreground/50 hover:text-foreground/80 transition-colors"
                              title="Clear all verdicts"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      )}
                      <span className="flex items-center gap-1 text-xs text-foreground/60">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(current!.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* Title */}
                  <h2 className="text-xl font-bold text-foreground leading-tight">{current!.title}</h2>

                  {/* Description */}
                  {current!.description && (
                    <p className="text-sm text-foreground/90 leading-relaxed">{current!.description}</p>
                  )}

                  {/* Gallery-level media (single image/video review like art director) */}
                  {galleryImage && !hasDecisions && (
                    <>
                      <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
                      <div className="rounded-lg overflow-hidden border border-primary/10 bg-black/20">
                        {isVideoUrl(galleryImage) ? (
                          <video
                            src={galleryImage}
                            controls
                            className="w-full max-h-[50vh] object-contain"
                          >
                            Your browser does not support video playback.
                          </video>
                        ) : (
                          <img
                            src={galleryImage}
                            alt={current!.title}
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
                              onToggle={(v) => toggleDecision(currentDecision.id, v)}
                              imageUrl={currentDecisionImage}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Summary strip */}
                      {decisions.length > 0 && (acceptCount > 0 || rejectCount > 0) && (
                        <div className="flex items-center gap-3 text-xs">
                          {acceptCount > 0 && <span className="text-emerald-400">{acceptCount} accepted</span>}
                          {rejectCount > 0 && <span className="text-red-400">{rejectCount} rejected</span>}
                          {undecidedCount > 0 && <span className="text-foreground/50">{undecidedCount} undecided</span>}
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
                        <div className="flex items-center gap-1.5 text-sm text-foreground/40">
                          <Zap className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="font-medium">Quick Actions</span>
                        </div>
                        {suggestedActions.map((action, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              setActiveAction('approve');
                              setActionNotes(action);
                            }}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground/80 bg-primary/5 border border-primary/10 hover:bg-primary/10 hover:border-primary/20 transition-colors text-left"
                          >
                            <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold flex-shrink-0">{i + 1}</span>
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
                      label={hasMultipleDecisions ? 'Reject all' : 'Reject'}
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
                      label="Retry with changes"
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
                      label={hasMultipleDecisions ? 'Accept all' : 'Approve'}
                      colorClasses="text-emerald-400 hover:bg-emerald-500/10"
                      activeClasses="bg-emerald-500/10"
                      notes={actionNotes}
                      onNotesChange={setActionNotes}
                      onConfirm={handleConfirmAction}
                      isProcessing={isProcessing}
                      confirmColor="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400"
                    />
                  </div>
                  <div className="text-center py-1.5 text-[11px] text-foreground/30 border-t border-primary/5">
                    {hasMultipleDecisions ? (
                      <>
                        <kbd className="px-1 py-0.5 rounded bg-foreground/5 text-foreground/40 font-mono">&#8592;</kbd> Reject this
                        <span className="mx-2 text-foreground/15">|</span>
                        <kbd className="px-1 py-0.5 rounded bg-foreground/5 text-foreground/40 font-mono">&#8595;</kbd> Retry
                        <span className="mx-2 text-foreground/15">|</span>
                        <kbd className="px-1 py-0.5 rounded bg-foreground/5 text-foreground/40 font-mono">&#8594;</kbd> Accept this
                      </>
                    ) : (
                      <>
                        <kbd className="px-1 py-0.5 rounded bg-foreground/5 text-foreground/40 font-mono">&#8592;</kbd> Reject
                        <span className="mx-2 text-foreground/15">|</span>
                        <kbd className="px-1 py-0.5 rounded bg-foreground/5 text-foreground/40 font-mono">&#8595;</kbd> Retry
                        <span className="mx-2 text-foreground/15">|</span>
                        <kbd className="px-1 py-0.5 rounded bg-foreground/5 text-foreground/40 font-mono">&#8594;</kbd> Approve
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

