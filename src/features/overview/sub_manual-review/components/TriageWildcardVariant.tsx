// TriageWildcardVariant — full-screen "Priority River" experiment.
// Mental model: reviews are tokens flowing left→right (oldest→newest) inside
// three horizontal lanes (Critical / Warning / Info). Color = persona; size =
// pulse weight for criticals. Click a token to open its detail. Drag any
// empty area to lasso-select a wedge of the river, then bulk-action it.
// Distinct from the grid: spatial + temporal density at-a-glance, not a matrix.

import { useMemo, useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, AlertCircle, AlertTriangle, Info, Check, MessageSquare, Sparkles } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import { stripPersonaPrefix } from '../libs/reviewHelpers';
import { ContextDataPreview } from './ReviewListItem';
import { silentCatch } from '@/lib/silentCatch';
import { DebtText, debtText } from '@/i18n/DebtText';



type SeverityBucket = 'critical' | 'warning' | 'info';

interface TriageWildcardVariantProps {
  reviews: ManualReviewItem[];
  isProcessing: boolean;
  onAction: (id: string, status: ManualReviewStatus, notes?: string) => void;
  onClose: () => void;
}

const LANES: Array<{ key: SeverityBucket; label: string; icon: typeof AlertCircle; ring: string; glow: string; dot: string; bg: string; track: string }> = [
  {
    key: 'critical',
    label: 'Critical',
    icon: AlertCircle,
    ring: 'ring-red-500/60',
    glow: 'shadow-[0_0_18px_rgba(239,68,68,0.45)]',
    dot: 'bg-red-400',
    bg: 'from-red-500/8 via-red-500/4 to-transparent',
    track: 'bg-gradient-to-r from-red-500/30 via-red-500/10 to-transparent',
  },
  {
    key: 'warning',
    label: 'Warning',
    icon: AlertTriangle,
    ring: 'ring-amber-500/55',
    glow: 'shadow-[0_0_14px_rgba(245,158,11,0.32)]',
    dot: 'bg-amber-400',
    bg: 'from-amber-500/7 via-amber-500/3 to-transparent',
    track: 'bg-gradient-to-r from-amber-500/22 via-amber-500/8 to-transparent',
  },
  {
    key: 'info',
    label: 'Info',
    icon: Info,
    ring: 'ring-blue-500/55',
    glow: 'shadow-[0_0_10px_rgba(59,130,246,0.28)]',
    dot: 'bg-blue-400',
    bg: 'from-blue-500/6 via-blue-500/3 to-transparent',
    track: 'bg-gradient-to-r from-blue-500/22 via-blue-500/8 to-transparent',
  },
];

function bucketOf(sev: string): SeverityBucket {
  if (sev === 'critical') return 'critical';
  if (sev === 'warning' || sev === 'high') return 'warning';
  return 'info';
}

interface PositionedToken {
  review: ManualReviewItem;
  lane: SeverityBucket;
  xRatio: number;
  laneIdxInRow: number;
}

interface LassoState {
  active: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export function TriageWildcardVariant({ reviews, isProcessing, onAction, onClose }: TriageWildcardVariantProps) {
  const pending = useMemo(() => reviews.filter((r) => r.status === 'pending'), [reviews]);

  // Bucket + sort by age (oldest→newest = left→right)
  const lanes = useMemo(() => {
    const grouped: Record<SeverityBucket, ManualReviewItem[]> = { critical: [], warning: [], info: [] };
    for (const r of pending) grouped[bucketOf(r.severity)].push(r);
    for (const k of Object.keys(grouped) as SeverityBucket[]) {
      grouped[k].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
    return grouped;
  }, [pending]);

  // Time bounds shared across lanes so x-position is comparable.
  const { minTime, maxTime } = useMemo(() => {
    if (pending.length === 0) return { minTime: 0, maxTime: 1 };
    let lo = Infinity, hi = -Infinity;
    for (const r of pending) {
      const t = new Date(r.created_at).getTime();
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    if (lo === hi) hi = lo + 1;
    return { minTime: lo, maxTime: hi };
  }, [pending]);

  const positions = useMemo<PositionedToken[]>(() => {
    const tokens: PositionedToken[] = [];
    for (const lane of LANES) {
      const items = lanes[lane.key];
      items.forEach((r, idx) => {
        const t = new Date(r.created_at).getTime();
        const xRatio = (t - minTime) / (maxTime - minTime);
        tokens.push({ review: r, lane: lane.key, xRatio, laneIdxInRow: idx });
      });
    }
    return tokens;
  }, [lanes, minTime, maxTime]);

  // Selection: set of review IDs selected via lasso or shift-click.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const activeReview = useMemo(() => pending.find((r) => r.id === activeId) ?? null, [pending, activeId]);

  useEffect(() => { setNotes(''); setShowNotes(false); }, [activeId]);

  // Esc → close detail, then close variant
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeId) setActiveId(null);
        else if (selectedIds.size > 0) setSelectedIds(new Set());
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, selectedIds.size, onClose]);

  // Lasso
  const canvasRef = useRef<HTMLDivElement>(null);
  const tokenRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const [lasso, setLasso] = useState<LassoState>({ active: false, startX: 0, startY: 0, endX: 0, endY: 0 });

  const onCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-token-button]')) return;
    if (target.closest('[data-lane-rail]')) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setLasso({ active: true, startX: sx, startY: sy, endX: sx, endY: sy });
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    setLasso((prev) => {
      if (!prev.active) return prev;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return prev;
      return { ...prev, endX: e.clientX - rect.left, endY: e.clientY - rect.top };
    });
  }, []);

  const onCanvasPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    setLasso((prev) => {
      if (!prev.active) return prev;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, active: false };
      const left = Math.min(prev.startX, prev.endX);
      const right = Math.max(prev.startX, prev.endX);
      const top = Math.min(prev.startY, prev.endY);
      const bottom = Math.max(prev.startY, prev.endY);
      if (right - left < 6 && bottom - top < 6) {
        return { ...prev, active: false };
      }
      const baseLeft = rect.left;
      const baseTop = rect.top;
      const hits = new Set<string>();
      tokenRectsRef.current.forEach((tokenRect, id) => {
        const tx = tokenRect.left - baseLeft + tokenRect.width / 2;
        const ty = tokenRect.top - baseTop + tokenRect.height / 2;
        if (tx >= left && tx <= right && ty >= top && ty <= bottom) hits.add(id);
      });
      if (hits.size > 0) {
        setSelectedIds((s) => {
          const next = new Set(s);
          hits.forEach((id) => next.add(id));
          return next;
        });
      }
      return { ...prev, active: false };
    });
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) { silentCatch("features/overview/sub_manual-review/components/TriageWildcardVariant:catch1")(err); }
  }, []);

  const handleSingle = useCallback((status: ManualReviewStatus) => {
    if (!activeReview || isProcessing) return;
    onAction(activeReview.id, status, notes || undefined);
    setActiveId(null);
  }, [activeReview, isProcessing, notes, onAction]);

  const handleBulk = useCallback((status: ManualReviewStatus) => {
    if (selectedIds.size === 0 || isProcessing) return;
    selectedIds.forEach((id) => onAction(id, status));
    setSelectedIds(new Set());
  }, [selectedIds, isProcessing, onAction]);

  const counts = useMemo(() => ({
    critical: lanes.critical.length,
    warning: lanes.warning.length,
    info: lanes.info.length,
    total: pending.length,
  }), [lanes, pending.length]);

  const ageSpanLabel = useMemo(() => {
    if (pending.length === 0) return '';
    return `${formatRelativeTime(new Date(minTime).toISOString())} → ${formatRelativeTime(new Date(maxTime).toISOString())}`;
  }, [pending.length, minTime, maxTime]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[80] bg-background/98 backdrop-blur-xl flex flex-col"
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 px-6 h-14 border-b border-primary/10 bg-secondary/15">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-modal bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="typo-heading font-semibold text-foreground leading-tight"><DebtText k="auto_triage_river_51a81681" /></h2>
            <p className="typo-caption text-foreground leading-tight"><DebtText k="auto_time_flow_across_severity_lanes_e7524094" /> {counts.total} <DebtText k="auto_pending_drag_empty_space_to_lasso_823476a3" /></p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-red-500/30 bg-red-500/10 text-red-400 typo-caption">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> {counts.critical}
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 typo-caption">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> {counts.warning}
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 typo-caption">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> {counts.info}
          </span>
          <button
            onClick={onClose}
            className="ml-2 p-1.5 rounded-modal border border-primary/15 text-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
            title={debtText("auto_close_esc_6ae84e4a")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bulk toolbar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            className="flex-shrink-0 flex items-center justify-between gap-4 px-6 h-11 border-b border-primary/10 bg-primary/8"
          >
            <div className="flex items-center gap-2">
              <span className="typo-heading font-medium text-foreground">{selectedIds.size} selected</span>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="typo-caption text-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulk('rejected' as ManualReviewStatus)}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal border border-red-500/25 bg-red-500/8 text-red-400 hover:bg-red-500/15 transition-colors disabled:opacity-40"
              >
                <X className="w-3.5 h-3.5" />
                <span className="typo-heading font-medium">Reject {selectedIds.size}</span>
              </button>
              <button
                onClick={() => handleBulk('approved' as ManualReviewStatus)}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal border border-emerald-500/25 bg-emerald-500/8 text-emerald-400 hover:bg-emerald-500/15 transition-colors disabled:opacity-40"
              >
                <Check className="w-3.5 h-3.5" />
                <span className="typo-heading font-medium">Approve {selectedIds.size}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Canvas + Detail */}
      <div className="flex-1 min-h-0 flex">
        <div
          ref={canvasRef}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          className="flex-1 min-w-0 relative select-none cursor-crosshair"
        >
          {/* Lanes */}
          <div className="absolute inset-0 flex flex-col gap-2 p-4">
            {LANES.map((lane) => (
              <RiverLane
                key={lane.key}
                lane={lane}
                tokens={positions.filter((p) => p.lane === lane.key)}
                selectedIds={selectedIds}
                activeId={activeId}
                onPick={setActiveId}
                onToggleSelect={(id, ev) => {
                  if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
                    ev.preventDefault();
                    setSelectedIds((s) => {
                      const next = new Set(s);
                      if (next.has(id)) next.delete(id); else next.add(id);
                      return next;
                    });
                  } else {
                    setActiveId(id);
                  }
                }}
                registerToken={(id, rect) => {
                  if (rect) tokenRectsRef.current.set(id, rect);
                  else tokenRectsRef.current.delete(id);
                }}
              />
            ))}
          </div>

          {/* Lasso rectangle */}
          {lasso.active && (
            <div
              className="absolute pointer-events-none border border-primary/60 bg-primary/10 rounded-card"
              style={{
                left: Math.min(lasso.startX, lasso.endX),
                top: Math.min(lasso.startY, lasso.endY),
                width: Math.abs(lasso.endX - lasso.startX),
                height: Math.abs(lasso.endY - lasso.startY),
              }}
            />
          )}

          {/* Empty state */}
          {pending.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <Check className="w-10 h-10 mx-auto text-emerald-400 mb-2" />
                <p className="typo-body text-foreground"><DebtText k="auto_all_clear_no_pending_reviews_71d77cf3" /></p>
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {activeReview && (
            <motion.aside
              key={activeReview.id}
              initial={{ x: 460, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 460, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="w-[460px] flex-shrink-0 border-l border-primary/10 bg-secondary/15 flex flex-col"
            >
              <DetailHeader review={activeReview} onClose={() => setActiveId(null)} />
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
                <h3 className="typo-body font-semibold text-foreground leading-tight">
                  {stripPersonaPrefix(activeReview.title, activeReview.persona_name)}
                </h3>
                {activeReview.content && (
                  <p className="typo-body text-foreground/85 whitespace-pre-wrap leading-relaxed">{activeReview.content}</p>
                )}
                {activeReview.context_data && (
                  <div className="rounded-card border border-primary/10 bg-secondary/30 px-3 py-2.5">
                    <div className="typo-caption font-mono uppercase text-foreground mb-1.5">Context</div>
                    <ContextDataPreview raw={activeReview.context_data} />
                  </div>
                )}
                {showNotes && (
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={debtText("auto_notes_optional_dbde2edd")}
                    rows={3}
                    autoFocus
                    className="w-full px-3 py-2 rounded-card border border-primary/15 bg-secondary/25 typo-body text-foreground placeholder:text-foreground/40 resize-none outline-none focus-visible:border-primary/40"
                  />
                )}
              </div>
              <div className="flex-shrink-0 border-t border-primary/10 p-3 grid grid-cols-3 gap-2 bg-secondary/10">
                <button
                  onClick={() => handleSingle('rejected' as ManualReviewStatus)}
                  disabled={isProcessing}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-modal border border-red-500/25 bg-red-500/8 text-red-400 hover:bg-red-500/15 transition-colors disabled:opacity-40"
                >
                  <X className="w-4 h-4" />
                  <span className="typo-heading font-medium">Reject</span>
                </button>
                <button
                  onClick={() => setShowNotes((s) => !s)}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-modal border transition-colors ${showNotes ? 'border-primary/30 bg-primary/15 text-primary' : 'border-primary/15 bg-secondary/20 text-foreground hover:text-foreground'}`}
                  title={debtText("auto_toggle_notes_e84e3c00")}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span className="typo-heading font-medium">Notes</span>
                </button>
                <button
                  onClick={() => handleSingle('approved' as ManualReviewStatus)}
                  disabled={isProcessing}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-modal border border-emerald-500/25 bg-emerald-500/8 text-emerald-400 hover:bg-emerald-500/15 transition-colors disabled:opacity-40"
                >
                  <Check className="w-4 h-4" />
                  <span className="typo-heading font-medium">Approve</span>
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* Time axis */}
      <div className="flex-shrink-0 h-9 px-6 flex items-center justify-between border-t border-primary/8 bg-secondary/10 typo-caption text-foreground">
        <span>{ageSpanLabel || '—'}</span>
        <span><DebtText k="auto_click_token_to_triage_4dcaac69" /> <kbd className="px-1 py-0.5 rounded bg-foreground/8 font-mono text-foreground">⇧</kbd><DebtText k="auto_click_to_multi_select_drag_to_lasso_4d5a0e4a" /> <kbd className="px-1 py-0.5 rounded bg-foreground/8 font-mono text-foreground">Esc</kbd> close</span>
      </div>
    </motion.div>
  );
}

interface RiverLaneProps {
  lane: (typeof LANES)[number];
  tokens: PositionedToken[];
  selectedIds: Set<string>;
  activeId: string | null;
  onPick: (id: string) => void;
  onToggleSelect: (id: string, ev: React.MouseEvent) => void;
  registerToken: (id: string, rect: DOMRect | null) => void;
}

function RiverLane({ lane, tokens, selectedIds, activeId, onPick, onToggleSelect, registerToken }: RiverLaneProps) {
  const Icon = lane.icon;
  return (
    <div className={`flex-1 min-h-0 relative rounded-modal border border-primary/10 bg-gradient-to-r ${lane.bg} overflow-hidden`}>
      {/* Lane label rail (kept short, no click) */}
      <div data-lane-rail className="absolute left-0 top-0 bottom-0 w-[110px] px-3 py-2 flex flex-col justify-between border-r border-primary/8 bg-background/30 backdrop-blur-sm">
        <div className="flex items-center gap-1.5">
          <Icon className={`w-3.5 h-3.5 ${lane.key === 'critical' ? 'text-red-400' : lane.key === 'warning' ? 'text-amber-400' : 'text-blue-400'}`} />
          <span className={`typo-caption uppercase tracking-wider font-medium ${lane.key === 'critical' ? 'text-red-400' : lane.key === 'warning' ? 'text-amber-400' : 'text-blue-400'}`}>
            {lane.label}
          </span>
        </div>
        <div className="typo-data-lg font-semibold text-foreground/85 leading-none">{tokens.length}</div>
      </div>

      {/* Track line */}
      <div className={`absolute left-[110px] right-4 top-1/2 -translate-y-1/2 h-px ${lane.track}`} />

      {/* Tokens */}
      <div className="absolute left-[110px] right-4 top-0 bottom-0">
        {tokens.map((tok) => (
          <RiverToken
            key={tok.review.id}
            tok={tok}
            lane={lane}
            isSelected={selectedIds.has(tok.review.id)}
            isActive={tok.review.id === activeId}
            onClick={(ev) => onToggleSelect(tok.review.id, ev)}
            onDoubleClick={() => onPick(tok.review.id)}
            registerToken={registerToken}
          />
        ))}
      </div>
    </div>
  );
}

interface RiverTokenProps {
  tok: PositionedToken;
  lane: (typeof LANES)[number];
  isSelected: boolean;
  isActive: boolean;
  onClick: (ev: React.MouseEvent) => void;
  onDoubleClick: () => void;
  registerToken: (id: string, rect: DOMRect | null) => void;
}

function RiverToken({ tok, lane, isSelected, isActive, onClick, onDoubleClick, registerToken }: RiverTokenProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    registerToken(tok.review.id, el.getBoundingClientRect());
    return () => registerToken(tok.review.id, null);
  });

  const sizePx = lane.key === 'critical' ? 18 : lane.key === 'warning' ? 16 : 14;
  const xPct = 2 + tok.xRatio * 96;
  // Stagger y within lane to prevent overlap on dense time clusters
  const yPct = ((tok.laneIdxInRow % 5) * 16) + 12;
  const personaColor = tok.review.persona_color || null;

  return (
    <button
      ref={ref}
      data-token-button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={`${tok.review.persona_name ?? 'Unassigned'} — ${stripPersonaPrefix(tok.review.title, tok.review.persona_name) || 'Untitled'}\nClick to open · Shift+click to multi-select`}
      className={`absolute rounded-full border-2 transition-all hover:scale-125 ${isSelected || isActive ? `ring-2 ${lane.ring} ${lane.glow}` : ''}`}
      style={{
        left: `calc(${xPct}% - ${sizePx / 2}px)`,
        top: `${yPct}%`,
        width: `${sizePx}px`,
        height: `${sizePx}px`,
        backgroundColor: personaColor ?? undefined,
        borderColor: personaColor ? 'rgba(255,255,255,0.35)' : undefined,
      }}
    >
      {!personaColor && <span className={`block w-full h-full rounded-full ${lane.dot}`} />}
    </button>
  );
}

function DetailHeader({ review, onClose }: { review: ManualReviewItem; onClose: () => void }) {
  const sevBucket = bucketOf(review.severity);
  const lane = LANES.find((l) => l.key === sevBucket)!;
  const Icon = lane.icon;
  return (
    <div className="flex-shrink-0 px-5 py-3 border-b border-primary/10 flex items-start gap-3 bg-secondary/20">
      <div className={`w-9 h-9 rounded-modal border flex items-center justify-center flex-shrink-0 ${sevBucket === 'critical' ? 'bg-red-500/10 border-red-500/30 text-red-400' : sevBucket === 'warning' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-blue-500/10 border-blue-500/30 text-blue-400'}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {review.persona_name && (
            <>
              <PersonaIcon icon={review.persona_icon ?? null} color={review.persona_color ?? null} size="w-3.5 h-3.5" />
              <span className="typo-caption text-foreground">{review.persona_name}</span>
              <span className="typo-caption text-foreground">·</span>
            </>
          )}
          <span className={`typo-caption font-medium uppercase ${sevBucket === 'critical' ? 'text-red-400' : sevBucket === 'warning' ? 'text-amber-400' : 'text-blue-400'}`}>
            {lane.label}
          </span>
          <span className="typo-caption text-foreground">·</span>
          <span className="typo-caption text-foreground">{formatRelativeTime(review.created_at)}</span>
        </div>
      </div>
      <button onClick={onClose} className="p-1 rounded text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export default TriageWildcardVariant;
