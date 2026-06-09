import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  motion, AnimatePresence, useMotionValue, useTransform,
} from 'framer-motion';
import {
  ArrowLeftRight, ThumbsDown, ThumbsUp, Trash2, ChevronLeft, ChevronRight, HelpCircle,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { useDevToolsActions } from '../hooks/useDevToolsActions';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { SCAN_AGENTS, AGENT_CATEGORIES } from '../constants/scanAgents';
import { DEFAULT_CATEGORY_TW, CATEGORY_TW } from '../constants/ideaColors';
import { LevelBadge } from '../sub_scanner/IdeaScannerCards';
import { TriageRulesPanel } from './TriageRulesPanel';
import { EffortRiskFilter } from './EffortRiskFilter';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { computeAgentStats } from '../sub_scanner/AgentScoreboard';
import { SHORTCUTS_OPEN_EVENT } from '@/lib/keyboard/shortcutRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CategoryKey = typeof AGENT_CATEGORIES[number]['key'];

interface TriageIdea {
  id: string;
  title: string;
  description: string;
  reasoning: string;
  category: CategoryKey;
  agentEmoji: string;
  agentLabel: string | null;
  agentRank: number | null;
  agentAcceptRate: number | null;
  effort: number;
  impact: number;
  risk: number;
  status: 'pending' | 'accepted' | 'rejected';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SWIPE_THRESHOLD = 150;


// ---------------------------------------------------------------------------
// Swipe Card
// ---------------------------------------------------------------------------

function SwipeCard({
  idea,
  isTop,
  stackIndex,
  onSwipe,
}: {
  idea: TriageIdea;
  isTop: boolean;
  stackIndex: number;
  onSwipe: (direction: 'left' | 'right') => void;
}) {
  const { t } = useTranslation();
  const dt = t.plugins.dev_tools;
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 0, 300], [-15, 0, 15]);
  const rejectOpacity = useTransform(x, [-SWIPE_THRESHOLD, -30, 0], [1, 0, 0]);
  const acceptOpacity = useTransform(x, [0, 30, SWIPE_THRESHOLD], [0, 0, 1]);

  // Border glow based on drag position
  const borderColor = useTransform(
    x,
    [-SWIPE_THRESHOLD, -30, 0, 30, SWIPE_THRESHOLD],
    [
      'rgba(239, 68, 68, 0.5)',
      'rgba(239, 68, 68, 0)',
      'rgba(255,255,255,0)',
      'rgba(34, 197, 94, 0)',
      'rgba(34, 197, 94, 0.5)',
    ],
  );

  const catTw = CATEGORY_TW[idea.category] ?? DEFAULT_CATEGORY_TW;
  const catLabel = AGENT_CATEGORIES.find((c) => c.key === idea.category)?.label ?? idea.category;

  const scale = 1 - stackIndex * 0.04;
  const yOffset = stackIndex * 8;
  const opacity = 1 - stackIndex * 0.15;

  return (
    <motion.div
      style={isTop ? { x, rotate, borderColor, zIndex: 10 - stackIndex } : { zIndex: 10 - stackIndex }}
      initial={{ scale, y: yOffset, opacity }}
      animate={{ scale, y: yOffset, opacity }}
      exit={isTop ? {
        x: x.get() > 0 ? 400 : -400,
        opacity: 0,
        rotate: x.get() > 0 ? 20 : -20,
        transition: { duration: 0.3 },
      } : { opacity: 0, scale: 0.9 }}
      drag={isTop ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.9}
      onDragEnd={(_, info) => {
        if (info.offset.x > SWIPE_THRESHOLD) onSwipe('right');
        else if (info.offset.x < -SWIPE_THRESHOLD) onSwipe('left');
      }}
      className={`absolute inset-0 border-2 rounded-2xl bg-background shadow-elevation-3 ${isTop ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none'}`}
    >
      {/* Swipe overlays */}
      {isTop && (
        <>
          <motion.div
            style={{ opacity: rejectOpacity }}
            className="absolute top-6 left-6 z-20 px-4 py-2 rounded-modal border-2 border-red-500 text-red-500 font-bold typo-heading-lg uppercase -rotate-12"
          >
            {dt.swipe_reject}
          </motion.div>
          <motion.div
            style={{ opacity: acceptOpacity }}
            className="absolute top-6 right-6 z-20 px-4 py-2 rounded-modal border-2 border-emerald-500 text-emerald-500 font-bold typo-heading-lg uppercase rotate-12"
          >
            {dt.swipe_accept}
          </motion.div>
        </>
      )}

      {/* Card content */}
      <div className="p-6 h-full flex flex-col">
        {/* Category + agent + effort/impact/risk */}
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          <span className="typo-heading-lg">{idea.agentEmoji}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-md font-medium ${catTw.bg} ${catTw.text} border ${catTw.border}`}>
            {catLabel}
          </span>
          {(['effort', 'impact', 'risk'] as const).map((key) => (
            <LevelBadge key={key} label={key} value={idea[key]} />
          ))}
        </div>

        {/* Title + description */}
        <h3 className="typo-heading-lg font-semibold text-primary mb-2">{idea.title}</h3>
        {idea.agentLabel && (
          <p className="text-md text-foreground -mt-1 mb-2 flex items-center gap-1.5 flex-wrap">
            <span>{idea.agentEmoji}</span>
            <span className="font-medium text-foreground/85">{idea.agentLabel}</span>
            {idea.agentRank !== null ? (
              <>
                <span className="text-foreground">·</span>
                <span className="text-foreground tabular-nums">
                  {dt.triage_agent_rank_prefix}#{idea.agentRank}
                </span>
                {idea.agentAcceptRate !== null && (
                  <span className="text-foreground tabular-nums">
                    ({Math.round(idea.agentAcceptRate * 100)}{dt.triage_agent_accept_suffix})
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="text-foreground">·</span>
                <span className="text-foreground italic">{dt.triage_agent_no_rank}</span>
              </>
            )}
          </p>
        )}
        <p className="text-md text-foreground mb-4 leading-relaxed flex-1 min-h-0 overflow-y-auto">
          {idea.description}
        </p>

        {/* Reasoning */}
        {idea.reasoning && (
          <div className="bg-primary/5 rounded-modal p-3">
            <p className="text-md uppercase tracking-wider text-primary font-medium mb-1">{dt.reasoning_label}</p>
            <p className="text-md text-foreground leading-relaxed">{idea.reasoning}</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function IdeaTriagePage() {
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;
  const { triageIdea, deleteIdea } = useDevToolsActions();
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const storeIdeas = useSystemStore((s) => s.ideas);
  const storeTasks = useSystemStore((s) => s.tasks);
  const fetchIdeas = useSystemStore((s) => s.fetchIdeas);
  const fetchTasks = useSystemStore((s) => s.fetchTasks);
  const triageCounts = useSystemStore((s) => s.triageCounts);

  // Per-agent rank map (1 = highest accept rate; agents with no signal sort
  // last). Computed from the same data the Scoreboard uses so the rank shown
  // on a triage card matches what the user sees in Idea Scanner.
  const agentRankByKey = useMemo(() => {
    const stats = computeAgentStats(storeIdeas, storeTasks);
    const ranked = [...stats].sort((a, b) => {
      const ar = a.acceptRate;
      const br = b.acceptRate;
      if (ar === null && br === null) return 0;
      if (ar === null) return 1;
      if (br === null) return -1;
      return br - ar;
    });
    const map = new Map<string, { rank: number; acceptRate: number | null }>();
    ranked.forEach((s, i) => map.set(s.agent.key, { rank: i + 1, acceptRate: s.acceptRate }));
    return map;
  }, [storeIdeas, storeTasks]);

  const [filterCategory, setFilterCategory] = useState<CategoryKey | 'all'>('all');
  const [filterScanType, setFilterScanType] = useState<string | null>(null);
  const [effortRange, setEffortRange] = useState<[number, number]>([1, 10]);
  const [riskRange, setRiskRange] = useState<[number, number]>([1, 10]);

  // Load ideas + tasks from store on mount / project change. Tasks are
  // needed so the inline scoreboard rank on each triage card has signal
  // even when the user opens Triage before Scanner this session.
  useEffect(() => {
    if (activeProjectId) {
      fetchIdeas(activeProjectId);
      fetchTasks(activeProjectId);
    }
  }, [activeProjectId, fetchIdeas, fetchTasks]);

  // Map store ideas to triage format
  const ideas: TriageIdea[] = useMemo(() =>
    storeIdeas.map((i) => {
      const agent = SCAN_AGENTS.find((a) => a.key === i.scan_type);
      const rankInfo = agentRankByKey.get(i.scan_type);
      return {
        id: i.id,
        title: i.title,
        description: i.description ?? '',
        reasoning: i.reasoning ?? '',
        category: (i.category as CategoryKey) || 'technical',
        agentEmoji: agent?.emoji ?? '?',
        agentLabel: agent?.label ?? null,
        agentRank: rankInfo?.rank ?? null,
        agentAcceptRate: rankInfo?.acceptRate ?? null,
        effort: i.effort ?? 5,
        impact: i.impact ?? 5,
        risk: i.risk ?? 5,
        status: (i.status as TriageIdea['status']) || 'pending',
      };
    }),
  [storeIdeas, agentRankByKey]);

  const pendingIdeas = ideas
    .filter((i) => i.status === 'pending' && (filterCategory === 'all' || i.category === filterCategory))
    .filter((i) => !filterScanType || storeIdeas.find((si) => si.id === i.id)?.scan_type === filterScanType)
    .filter((i) => i.effort >= effortRange[0] && i.effort <= effortRange[1])
    .filter((i) => i.risk >= riskRange[0] && i.risk <= riskRange[1]);
  const acceptedCount = triageCounts?.accepted ?? ideas.filter((i) => i.status === 'accepted').length;
  const rejectedCount = triageCounts?.rejected ?? ideas.filter((i) => i.status === 'rejected').length;
  const pendingCount = triageCounts?.pending ?? ideas.filter((i) => i.status === 'pending').length;
  const totalCount = ideas.length;

  // End-of-session summary toast. Snapshot the accepted/rejected counts on
  // first non-empty mount; when pending later hits zero and the user has
  // actually triaged something this session, fire a single celebratory
  // toast — then arm the "fired" flag so re-renders don't refire it.
  const addToastTriage = useToastStore((s) => s.addToast);
  const [sessionStart] = useState<{ accepted: number; rejected: number; t: number }>(
    () => ({ accepted: acceptedCount, rejected: rejectedCount, t: Date.now() }),
  );
  const [summaryFired, setSummaryFired] = useState(false);
  useEffect(() => {
    if (summaryFired) return;
    if (pendingCount !== 0) return;
    const dAccepted = acceptedCount - sessionStart.accepted;
    const dRejected = rejectedCount - sessionStart.rejected;
    const total = dAccepted + dRejected;
    if (total < 3) return; // Don't fire for trivial sessions (1-2 swipes).
    const minutes = Math.max(1, Math.round((Date.now() - sessionStart.t) / 60000));
    addToastTriage(
      tx(dt.triage_session_summary, { total, accepted: dAccepted, rejected: dRejected, minutes }),
      'success',
    );
    setSummaryFired(true);
  }, [pendingCount, acceptedCount, rejectedCount, sessionStart, summaryFired, addToastTriage, tx, dt.triage_session_summary]);

  const visibleStack = pendingIdeas.slice(0, 3);

  // Keep a ref to always have the latest pending ideas — avoids stale closure
  // in the keyboard handler when the effect teardown/re-register races with
  // rapid keypresses after a triage action.
  const pendingRef = useRef(pendingIdeas);
  pendingRef.current = pendingIdeas;

  const handleSwipe = useCallback((direction: 'left' | 'right') => {
    const idea = pendingRef.current[0];
    if (!idea) return;
    const decision = direction === 'right' ? 'accepted' : 'rejected';
    triageIdea(idea.id, decision);
  }, [triageIdea]);

  const handleDelete = useCallback(() => {
    const idea = pendingRef.current[0];
    if (!idea) return;
    deleteIdea(idea.id);
  }, [deleteIdea]);

  // Keyboard shortcuts — stable listener (no dep on handleSwipe/pendingIdeas)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return;

      // `?` / Escape are handled by the global ShortcutCheatSheet overlay; the
      // triage page only owns the swipe-action keys below.
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        handleSwipe('left');
      } else if (e.key === 'ArrowRight' || e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        handleSwipe('right');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSwipe]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<ArrowLeftRight className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={dt.triage_title}
        subtitle={dt.triage_subtitle}
        actions={<LifecycleProjectPicker />}
      />

      <ContentBody>
        <ActionRow
          left={
            <>
              <span className="rounded-full px-2.5 py-0.5 typo-caption font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                {tx(dt.accepted_badge, { count: acceptedCount })}
              </span>
              <span className="rounded-full px-2.5 py-0.5 typo-caption font-medium bg-red-500/15 text-red-400 border border-red-500/25">
                {tx(dt.rejected_badge, { count: rejectedCount })}
              </span>
              <span className="rounded-full px-2.5 py-0.5 typo-caption font-medium bg-amber-500/15 text-amber-400 border border-amber-500/25">
                {tx(dt.pending_badge, { count: pendingCount })}
              </span>
            </>
          }
        >
          <button
            onClick={() => window.dispatchEvent(new CustomEvent(SHORTCUTS_OPEN_EVENT))}
            className="w-7 h-7 rounded-card bg-primary/5 border border-primary/10 flex items-center justify-center hover:bg-primary/10 transition-colors"
            title={dt.shortcuts_open_title}
          >
            <HelpCircle className="w-3.5 h-3.5 text-foreground" />
          </button>
        </ActionRow>
        {/* Auto-Triage Rules Panel */}
        {activeProjectId && (
          <div className="mb-4">
            <TriageRulesPanel projectId={activeProjectId} />
          </div>
        )}

        <div className="flex gap-2 h-full min-h-[500px]">
          {/* Left sidebar: category + scan type filters + effort/risk filter */}
          <div className="w-52 flex-shrink-0 space-y-1">
            <h3 className="text-md uppercase tracking-wider text-primary font-medium mb-2">
              {dt.sidebar_category}
            </h3>
            <button
              onClick={() => { setFilterCategory('all'); setFilterScanType(null); }}
              className={`w-full text-left px-3 py-2 rounded-card text-md transition-colors ${
                filterCategory === 'all' && !filterScanType
                  ? 'bg-primary/10 text-foreground font-medium'
                  : 'text-foreground hover:bg-primary/5'
              }`}
            >
              {tx(dt.sidebar_all, { count: pendingCount })}
            </button>
            {AGENT_CATEGORIES.map((cat) => {
              const count = ideas.filter((i) => i.status === 'pending' && i.category === cat.key).length;
              const catTw = CATEGORY_TW[cat.key] ?? DEFAULT_CATEGORY_TW;
              return (
                <button
                  key={cat.key}
                  onClick={() => { setFilterCategory(cat.key as CategoryKey); setFilterScanType(null); }}
                  className={`w-full text-left px-3 py-2 rounded-card text-md transition-colors flex items-center gap-2 ${
                    filterCategory === cat.key && !filterScanType
                      ? 'bg-primary/10 text-foreground font-medium'
                      : 'text-foreground hover:bg-primary/5'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${catTw.dot}`} />
                  <span className="flex-1">{cat.label}</span>
                  <span className="text-foreground">{count}</span>
                </button>
              );
            })}

            {/* Scan type filter */}
            <h3 className="text-md uppercase tracking-wider text-primary font-medium mt-3 pt-3 border-t border-border/15 mb-2">
              {dt.sidebar_scan_type}
            </h3>
            <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
              {SCAN_AGENTS.filter((a) => {
                // Only show scan types that have ideas
                return ideas.some((i) => storeIdeas.find((si) => si.id === i.id)?.scan_type === a.key);
              }).map((agent) => {
                const count = ideas.filter((i) => i.status === 'pending' && storeIdeas.find((si) => si.id === i.id)?.scan_type === agent.key).length;
                return (
                  <button
                    key={agent.key}
                    onClick={() => { setFilterScanType(filterScanType === agent.key ? null : agent.key); setFilterCategory('all'); }}
                    className={`w-full text-left px-3 py-1.5 rounded-card text-md transition-colors flex items-center gap-2 ${
                      filterScanType === agent.key
                        ? 'bg-primary/10 text-foreground font-medium'
                        : 'text-foreground hover:bg-primary/5'
                    }`}
                  >
                    <span>{agent.emoji}</span>
                    <span className="flex-1 truncate">{agent.label}</span>
                    <span className="text-foreground">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Effort / Risk filters */}
            <div className="pt-3 mt-3 border-t border-border/15">
              <EffortRiskFilter
                effortRange={effortRange}
                riskRange={riskRange}
                onEffortChange={setEffortRange}
                onRiskChange={setRiskRange}
              />
            </div>
          </div>

          {/* Center: card stack */}
          <div className="flex-1 flex flex-col items-center justify-center" style={{ minWidth: '540px' }}>
            {/* Progress bar */}
            {totalCount > 0 && (
              <div className="w-full max-w-lg mb-6">
                <div className="flex items-center justify-between text-md text-foreground mb-1.5">
                  <span>{tx(dt.remaining_count, { count: pendingIdeas.length })}</span>
                  <span>{tx(dt.reviewed_count, { done: totalCount - pendingCount, total: totalCount })}</span>
                </div>
                <div className="w-full h-1.5 bg-primary/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 rounded-full transition-all duration-300"
                    style={{ width: totalCount > 0 ? `${((totalCount - pendingCount) / totalCount) * 100}%` : '0%' }}
                  />
                </div>
              </div>
            )}

            {/* Card stack */}
            {pendingIdeas.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
                  <ArrowLeftRight className="w-7 h-7 text-amber-400/50" />
                </div>
                <p className="text-md text-foreground mb-1">
                  {totalCount === 0 ? dt.empty_no_ideas : dt.empty_all_reviewed}
                </p>
                <p className="text-md text-foreground">
                  {totalCount === 0
                    ? dt.empty_no_ideas_hint
                    : tx(dt.empty_all_reviewed_summary, { accepted: acceptedCount, rejected: rejectedCount })}
                </p>
              </div>
            ) : (
              <div className="relative w-full max-w-lg" style={{ height: '420px' }}>
                <AnimatePresence>
                  {visibleStack.map((idea, i) => (
                    <SwipeCard
                      key={idea.id}
                      idea={idea}
                      isTop={i === 0}
                      stackIndex={i}
                      onSwipe={handleSwipe}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* Action bar */}
            {pendingIdeas.length > 0 && (
              <div className="flex items-center gap-4 mt-6">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => handleSwipe('left')}
                  className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center hover:bg-red-500/20 transition-colors"
                  title={dt.shortcuts_btn_reject_title}
                >
                  <ThumbsDown className="w-5 h-5 text-red-400" />
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleDelete}
                  className="w-10 h-10 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center hover:bg-primary/15 transition-colors"
                  title={dt.shortcuts_btn_delete_title}
                >
                  <Trash2 className="w-4 h-4 text-foreground" />
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => handleSwipe('right')}
                  className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center hover:bg-emerald-500/20 transition-colors"
                  title={dt.shortcuts_btn_accept_title}
                >
                  <ThumbsUp className="w-5 h-5 text-emerald-400" />
                </motion.button>
              </div>
            )}

            {/* Keyboard hint */}
            {pendingIdeas.length > 0 && (
              <p className="text-md text-foreground mt-3 flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <ChevronLeft className="w-3 h-3" /> / A = {dt.hint_reject}
                </span>
                <span className="flex items-center gap-1">
                  <ChevronRight className="w-3 h-3" /> / Z = {dt.hint_accept}
                </span>
              </p>
            )}
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
