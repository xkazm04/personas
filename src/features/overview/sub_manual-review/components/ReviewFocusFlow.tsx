import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  X,
  AlertTriangle,
  Info,
  AlertCircle,
  Clock,
  Zap,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Video,
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { ContextDataPreview } from './ReviewListItem';
import { parseSuggestedActions } from '../libs/reviewHelpers';
import { useOverviewTranslation } from '@/features/overview/i18n/useOverviewTranslation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TriageReview {
  id: string;
  title: string;
  description?: string | null;
  severity: string;
  persona_name?: string;
  persona_icon?: string;
  persona_color?: string;
  context_data?: string | null;
  suggested_actions?: string | null;
  created_at: string;
  status: string;
}

interface ReviewFocusFlowProps {
  reviews: TriageReview[];
  onApprove: (id: string, notes?: string) => void;
  onReject: (id: string, notes?: string) => void;
  isProcessing: boolean;
}

// ---------------------------------------------------------------------------
// Decision type — extended with image support
// ---------------------------------------------------------------------------

interface DecisionItem {
  id: string;
  label: string;
  description?: string;
  category?: string;
  /** Direct image URL for visual decisions */
  image_url?: string;
  /** Gallery asset reference (resolved to local file path) */
  gallery_image_ref?: string;
  /** Any additional image URLs embedded in metadata */
  preview_url?: string;
}

function parseDecisions(contextData: string | null | undefined): { decisions: DecisionItem[]; galleryImage: string | null; raw: Record<string, unknown> | null } {
  if (!contextData) return { decisions: [], galleryImage: null, raw: null };
  try {
    const parsed = JSON.parse(contextData);
    if (!parsed || typeof parsed !== 'object') return { decisions: [], galleryImage: null, raw: null };
    const decisions: DecisionItem[] = Array.isArray(parsed.decisions) ? parsed.decisions : [];
    const galleryImage = parsed.gallery_image_ref ?? parsed.image_url ?? null;
    return { decisions, galleryImage, raw: parsed };
  } catch {
    return { decisions: [], galleryImage: null, raw: null };
  }
}

/** Check if a decision has any visual content */
function getDecisionImage(d: DecisionItem): string | null {
  return d.image_url || d.gallery_image_ref || d.preview_url || null;
}

/** Detect video URLs by extension */
const VIDEO_EXT_RE = /\.(mp4|webm|mov|avi|mkv|ogv)(\?.*)?$/i;
function isVideoUrl(url: string): boolean {
  return VIDEO_EXT_RE.test(url);
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<string, { gradient: string; icon: React.ReactNode; label: string; shadow: string; ring: string }> = {
  critical: {
    gradient: 'from-red-500 via-red-400 to-red-500',
    icon: <AlertCircle className="w-4 h-4" />,
    label: 'Critical',
    shadow: '0 0 40px -12px rgba(239,68,68,0.20)',
    ring: 'ring-red-500/10',
  },
  warning: {
    gradient: 'from-amber-500 via-amber-400 to-amber-500',
    icon: <AlertTriangle className="w-4 h-4" />,
    label: 'Warning',
    shadow: '0 0 40px -12px rgba(245,158,11,0.20)',
    ring: 'ring-amber-500/10',
  },
  info: {
    gradient: 'from-emerald-500 via-emerald-400 to-emerald-500',
    icon: <Info className="w-4 h-4" />,
    label: 'Info',
    shadow: '0 0 40px -12px rgba(16,185,129,0.20)',
    ring: 'ring-emerald-500/10',
  },
};

function getSevCfg(severity: string) {
  return SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info!;
}

// ---------------------------------------------------------------------------
// Category colors for decision cards
// ---------------------------------------------------------------------------

const CAT_STYLE: Record<string, string> = {
  security: 'border-l-red-500',
  performance: 'border-l-amber-500',
  architecture: 'border-l-blue-500',
  data: 'border-l-purple-500',
  ux: 'border-l-emerald-500',
  workflow: 'border-l-cyan-500',
  content: 'border-l-violet-500',
  default: 'border-l-primary/40',
};

function catBorder(cat?: string) {
  if (!cat) return CAT_STYLE.default!;
  return CAT_STYLE[cat.toLowerCase()] ?? CAT_STYLE.default!;
}

// ---------------------------------------------------------------------------
// Severity dot color for queue sidebar
// ---------------------------------------------------------------------------

const SEV_DOT: Record<string, string> = {
  critical: 'bg-red-400',
  warning: 'bg-amber-400',
  high: 'bg-amber-400',
  info: 'bg-blue-400',
  low: 'bg-foreground/40',
};

function sevDot(severity: string) { return SEV_DOT[severity] ?? SEV_DOT.info!; }

// ---------------------------------------------------------------------------
// Severity badge
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = getSevCfg(severity);
  const bgMap: Record<string, string> = {
    critical: 'bg-red-500/15 text-red-400 border-red-500/20',
    warning: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    info: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${bgMap[severity] ?? bgMap.info!}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Decision verdict type
// ---------------------------------------------------------------------------

type DecisionVerdict = 'accept' | 'reject' | undefined;

// ---------------------------------------------------------------------------
// Animated card variants
// ---------------------------------------------------------------------------

const cardVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 300 : -300, opacity: 0, scale: 0.96 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -300 : 300, opacity: 0, scale: 0.96 }),
};

const decisionVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 200 : -200, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -200 : 200, opacity: 0 }),
};

// ---------------------------------------------------------------------------
// Action type
// ---------------------------------------------------------------------------

type ActionType = 'reject' | 'retry' | 'approve' | null;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReviewFocusFlow({ reviews, onApprove, onReject, isProcessing }: ReviewFocusFlowProps) {
  const { t } = useOverviewTranslation();
  const pending = useMemo(() => reviews.filter((r) => r.status === 'pending'), [reviews]);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [reviewDir, setReviewDir] = useState(0);
  const [decisionIdx, setDecisionIdx] = useState(0);
  const [decisionDir, setDecisionDir] = useState(0);
  const [activeAction, setActiveAction] = useState<ActionType>(null);
  const [actionNotes, setActionNotes] = useState('');
  const [decisionVerdicts, setDecisionVerdicts] = useState<Record<string, DecisionVerdict>>({});

  // -- Progress tracking --
  const initialQueueSizeRef = useRef(0);
  const prevPendingRef = useRef(pending.length);
  const [showCelebration, setShowCelebration] = useState(false);

  // Capture initial queue size on first render with items
  useEffect(() => {
    if (pending.length > 0 && initialQueueSizeRef.current === 0) {
      initialQueueSizeRef.current = pending.length;
    }
  }, [pending.length]);

  // Detect queue-clear transition → celebration
  useEffect(() => {
    if (prevPendingRef.current > 0 && pending.length === 0 && initialQueueSizeRef.current > 0) {
      setShowCelebration(true);
    }
    prevPendingRef.current = pending.length;
  }, [pending.length]);

  const processedCount = initialQueueSizeRef.current - pending.length;

  // Keep index in bounds
  useEffect(() => {
    if (reviewIdx >= pending.length && pending.length > 0) setReviewIdx(pending.length - 1);
  }, [pending.length, reviewIdx]);

  const resetAction = useCallback(() => { setActiveAction(null); setActionNotes(''); }, []);

  const current = pending[reviewIdx] ?? null;

  // Reset when the actual review changes (keyed on id, not index, so array
  // shifts after approve/reject still trigger a reset).
  const currentReviewId = current?.id;
  useEffect(() => {
    setDecisionVerdicts({});
    setDecisionIdx(0);
    resetAction();
  }, [currentReviewId, resetAction]);
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
  // Empty / celebration state
  // -----------------------------------------------------------------------
  if (pending.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
        {showCelebration ? (
          <>
            {/* Animated checkmark ring */}
            <motion.div
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              className="relative w-20 h-20"
            >
              {/* Outer glow pulse */}
              <motion.div
                className="absolute inset-0 rounded-full bg-emerald-500/20"
                animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
              <div className="w-20 h-20 rounded-full bg-emerald-500/15 flex items-center justify-center ring-2 ring-emerald-500/30">
                <motion.div
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ delay: 0.3, duration: 0.4 }}
                >
                  <Check className="w-10 h-10 text-emerald-400" strokeWidth={2.5} />
                </motion.div>
              </div>
            </motion.div>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="typo-heading text-foreground"
            >
              {t.reviewFocus.all_caught_up}
            </motion.p>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="typo-body text-foreground"
            >
              {t.reviewFocus.queue_cleared}
            </motion.p>
            {/* Processed count badge */}
            {initialQueueSizeRef.current > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.8 }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="typo-caption text-emerald-400">
                  {t.reviewFocus.processed_count.replace('{count}', String(initialQueueSizeRef.current))}
                </span>
              </motion.div>
            )}
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Check className="w-8 h-8 text-emerald-400" />
            </div>
            <p className="typo-heading text-foreground">{t.reviewFocus.all_caught_up}</p>
            <p className="typo-body text-foreground">{t.reviewFocus.no_pending_reviews}</p>
          </>
        )}
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
        {/* Top nav bar with progress */}
        <div className="flex-shrink-0 border-b border-primary/10 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center justify-between px-6 py-2">
            <div className="flex items-center gap-3">
              <span className="typo-body text-foreground">
                {t.reviewFocus.progress_of
                  .replace('{current}', String(reviewIdx + 1))
                  .replace('{total}', String(pending.length))}
              </span>
              {processedCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span className="typo-caption text-emerald-400">
                    {t.reviewFocus.processed_count.replace('{count}', String(processedCount))}
                  </span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={goPrevReview} disabled={reviewIdx === 0} className="p-1.5 rounded-interactive hover:bg-primary/10 disabled:opacity-30 transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={goNextReview} disabled={reviewIdx >= pending.length - 1} className="p-1.5 rounded-interactive hover:bg-primary/10 disabled:opacity-30 transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          {/* Thin progress bar */}
          {initialQueueSizeRef.current > 0 && (
            <div className="h-0.5 bg-primary/5">
              <motion.div
                className="h-full bg-emerald-500/60"
                initial={false}
                animate={{ width: `${(processedCount / initialQueueSizeRef.current) * 100}%` }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
            </div>
          )}
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
                          <button onClick={goPrevDecision} disabled={decisionIdx === 0} className="p-0.5 rounded hover:bg-secondary/40 disabled:opacity-30 transition-colors">
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
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
                          <button onClick={goNextDecision} disabled={decisionIdx >= decisions.length - 1} className="p-0.5 rounded hover:bg-secondary/40 disabled:opacity-30 transition-colors">
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
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

// ---------------------------------------------------------------------------
// Focused Decision Card — adaptive layout for text, image, or mixed
// ---------------------------------------------------------------------------

interface FocusedDecisionCardProps {
  decision: DecisionItem;
  verdict: DecisionVerdict;
  onToggle: (v: DecisionVerdict) => void;
  imageUrl: string | null;
}

function FocusedDecisionCard({ decision, verdict, onToggle, imageUrl }: FocusedDecisionCardProps) {
  const hasImage = !!imageUrl;

  return (
    <div className={`rounded-lg border border-primary/10 overflow-hidden border-l-2 ${catBorder(decision.category)}`}>
      {hasImage ? (
        /* ---- Image + Text side-by-side layout ---- */
        <div className="flex flex-col md:flex-row">
          {/* Media panel (image or video) */}
          <div className="md:w-1/2 bg-black/20 flex items-center justify-center min-h-[200px] max-h-[400px] overflow-hidden">
            {isVideoUrl(imageUrl!) ? (
              <video
                src={imageUrl!}
                controls
                className="w-full h-full object-contain"
                onError={(e) => {
                  (e.target as HTMLVideoElement).style.display = 'none';
                  (e.target as HTMLVideoElement).parentElement!.innerHTML = '<div class="flex flex-col items-center gap-2 py-12 text-foreground/30"><svg class="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg><span class="text-sm">Video unavailable</span></div>';
                }}
              >
                Your browser does not support video playback.
              </video>
            ) : (
              <img
                src={imageUrl!}
                alt={decision.label}
                className="w-full h-full object-contain"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="flex flex-col items-center gap-2 py-12 text-foreground/30"><svg class="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25a1.5 1.5 0 001.5 1.5z" /></svg><span class="text-sm">Image unavailable</span></div>';
                }}
              />
            )}
          </div>
          {/* Text panel */}
          <div className="md:w-1/2 p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                {decision.category && (
                  <span className="text-xs font-medium text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">{decision.category}</span>
                )}
                {isVideoUrl(imageUrl!) ? (
                  <Video className="w-3 h-3 text-foreground/30" />
                ) : (
                  <ImageIcon className="w-3 h-3 text-foreground/30" />
                )}
              </div>
              <h3 className="text-base font-semibold text-foreground mb-2">{decision.label}</h3>
              {decision.description && (
                <p className="text-sm text-foreground/80 leading-relaxed">{decision.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-primary/10">
              <button
                onClick={() => onToggle('accept')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${verdict === 'accept'
                    ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                    : 'bg-secondary/30 text-foreground/60 hover:bg-emerald-500/10 hover:text-emerald-400'
                  }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                Accept
              </button>
              <button
                onClick={() => onToggle('reject')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${verdict === 'reject'
                    ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30'
                    : 'bg-secondary/30 text-foreground/60 hover:bg-red-500/10 hover:text-red-400'
                  }`}
              >
                <XCircle className="w-4 h-4" />
                Reject
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ---- Text-only layout (full width, spacious) ---- */
        <div className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                {decision.category && (
                  <span className="text-xs font-medium text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">{decision.category}</span>
                )}
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1">{decision.label}</h3>
              {decision.description && (
                <p className="text-sm text-foreground/80 leading-relaxed">{decision.description}</p>
              )}
            </div>
            {/* Prominent accept/reject buttons */}
            <div className="flex items-center gap-1.5 flex-shrink-0 pt-1">
              <button
                onClick={() => onToggle('accept')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${verdict === 'accept'
                    ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                    : 'bg-secondary/30 text-foreground/50 hover:bg-emerald-500/10 hover:text-emerald-400'
                  }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                Accept
              </button>
              <button
                onClick={() => onToggle('reject')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${verdict === 'reject'
                    ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30'
                    : 'bg-secondary/30 text-foreground/50 hover:bg-red-500/10 hover:text-red-400'
                  }`}
              >
                <XCircle className="w-4 h-4" />
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action Zone sub-component
// ---------------------------------------------------------------------------

interface ActionZoneProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  colorClasses: string;
  activeClasses: string;
  notes: string;
  onNotesChange: (v: string) => void;
  onConfirm: () => void;
  isProcessing: boolean;
  confirmColor: string;
}

function ActionZone({ active, onClick, icon, label, colorClasses, activeClasses, notes, onNotesChange, onConfirm, isProcessing, confirmColor }: ActionZoneProps) {
  return (
    <div className={`flex flex-col transition-colors ${active ? activeClasses : ''}`}>
      <button
        onClick={onClick}
        disabled={isProcessing}
        className={`flex items-center justify-center gap-2 py-4 text-sm font-medium transition-colors disabled:opacity-50 ${colorClasses}`}
      >
        {icon}
        <span>{label}</span>
      </button>
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              <textarea
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder="Add a note (optional)..."
                rows={2}
                className="w-full rounded-md border border-primary/10 bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                autoFocus
              />
              <button
                onClick={onConfirm}
                disabled={isProcessing}
                className={`w-full py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 ${confirmColor}`}
              >
                {isProcessing ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
