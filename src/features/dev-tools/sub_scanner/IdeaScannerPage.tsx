import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lightbulb, Play, CheckSquare, Square, Clock,
  BarChart3,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useDevToolsActions } from '../hooks/useDevToolsActions';
import { useSystemStore } from '@/stores/systemStore';
import {
  SCAN_AGENTS, AGENT_CATEGORIES,
  type ScanAgentDef,
} from '../constants/scanAgents';

// ---------------------------------------------------------------------------
// Types (local until devToolsSlice wired)
// ---------------------------------------------------------------------------

type CategoryKey = typeof AGENT_CATEGORIES[number]['key'];

interface ScanIdea {
  id: string;
  title: string;
  description: string;
  category: CategoryKey;
  agentKey: string;
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
}

interface ScanHistoryEntry {
  id: string;
  agentKey: string;
  ideaCount: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Tailwind-safe color map (hex colors from constants -> Tailwind classes)
// ---------------------------------------------------------------------------

const COLOR_MAP: Record<string, { bg: string; text: string; border: string }> = {
  '#3B82F6': { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/25' },
  '#EF4444': { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/25' },
  '#8B5CF6': { bg: 'bg-violet-500/15', text: 'text-violet-400', border: 'border-violet-500/25' },
  '#10B981': { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/25' },
  '#F59E0B': { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/25' },
  '#EC4899': { bg: 'bg-pink-500/15', text: 'text-pink-400', border: 'border-pink-500/25' },
  '#6366F1': { bg: 'bg-indigo-500/15', text: 'text-indigo-400', border: 'border-indigo-500/25' },
  '#14B8A6': { bg: 'bg-teal-500/15', text: 'text-teal-400', border: 'border-teal-500/25' },
  '#F97316': { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/25' },
  '#06B6D4': { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/25' },
};

const DEFAULT_CAT_TW = { bg: 'bg-blue-500/15', text: 'text-blue-400', dot: 'bg-blue-400', border: 'border-blue-500/25' };
const CATEGORY_TW: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  technical: { bg: 'bg-blue-500/15', text: 'text-blue-400', dot: 'bg-blue-400', border: 'border-blue-500/25' },
  user: { bg: 'bg-pink-500/15', text: 'text-pink-400', dot: 'bg-pink-400', border: 'border-pink-500/25' },
  business: { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400', border: 'border-amber-500/25' },
  mastermind: { bg: 'bg-violet-500/15', text: 'text-violet-400', dot: 'bg-violet-400', border: 'border-violet-500/25' },
};

function agentColor(agent: ScanAgentDef) {
  return COLOR_MAP[agent.color] ?? { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/20' };
}

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

const LEVEL_STYLES: Record<string, string> = {
  low: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  high: 'bg-red-500/15 text-red-400 border-red-500/25',
};

function LevelBadge({ label, level }: { label: string; level: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${LEVEL_STYLES[level] ?? LEVEL_STYLES.low}`}>
      {label}: {level}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

function AgentCard({
  agent,
  selected,
  onToggle,
}: {
  agent: ScanAgentDef;
  selected: boolean;
  onToggle: () => void;
}) {
  const ac = agentColor(agent);
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onToggle}
      className={`relative flex flex-col items-start p-3.5 rounded-xl border text-left transition-colors ${
        selected
          ? 'bg-primary/10 border-primary/20 ring-1 ring-amber-500/20'
          : 'border-primary/10 hover:bg-primary/5 hover:border-primary/20'
      }`}
    >
      <div className={`w-9 h-9 rounded-lg ${ac.bg} border ${ac.border} flex items-center justify-center text-lg mb-2`}>
        {agent.emoji}
      </div>
      <span className="text-sm font-medium text-foreground/80 mb-0.5">{agent.label}</span>
      <span className="text-[10px] text-muted-foreground/50 line-clamp-2 leading-relaxed">{agent.description}</span>
      <div className="absolute top-3 right-3">
        {selected ? (
          <CheckSquare className="w-4 h-4 text-amber-400" />
        ) : (
          <Square className="w-4 h-4 text-muted-foreground/25" />
        )}
      </div>
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// Scan Progress
// ---------------------------------------------------------------------------

function ScanProgress({
  running,
  currentAgent,
  progress,
}: {
  running: boolean;
  currentAgent: ScanAgentDef | null;
  progress: number;
}) {
  if (!running) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="border border-amber-500/20 bg-amber-500/5 rounded-xl p-4"
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center text-sm">
          {currentAgent?.emoji ?? '...'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground/80">
            Scanning with {currentAgent?.label ?? '...'}
          </p>
          <p className="text-[10px] text-muted-foreground/50">
            Analyzing codebase patterns and generating ideas
          </p>
        </div>
        <span className="text-xs text-amber-400 font-medium">{Math.round(progress)}%</span>
      </div>
      <div className="w-full h-1.5 bg-primary/10 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-amber-400 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Idea Card
// ---------------------------------------------------------------------------

function IdeaCard({ idea, index }: { idea: ScanIdea; index: number }) {
  const { staggerDelay } = useMotion();
  const catTw = CATEGORY_TW[idea.category] ?? DEFAULT_CAT_TW;
  const agent = SCAN_AGENTS.find((a) => a.key === idea.agentKey);
  const ac = agent ? agentColor(agent) : { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/20' };
  const catLabel = AGENT_CATEGORIES.find((c) => c.key === idea.category)?.label ?? idea.category;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * staggerDelay }}
      className="border border-primary/10 rounded-xl p-4 hover:bg-primary/5 hover:border-primary/20 transition-colors"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-7 h-7 rounded-lg ${ac.bg} border ${ac.border} flex items-center justify-center text-sm flex-shrink-0`}>
          {agent?.emoji ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground/80 mb-0.5">{idea.title}</h4>
          <p className="text-xs text-muted-foreground/60 line-clamp-2">{idea.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${catTw.bg} ${catTw.text} border ${catTw.border}`}>
          {catLabel}
        </span>
        <LevelBadge label="Effort" level={idea.effort} />
        <LevelBadge label="Impact" level={idea.impact} />
        <LevelBadge label="Risk" level={idea.risk} />
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function IdeaScannerPage() {
  const { runScan } = useDevToolsActions();

  // Wire to store for real idea data — survives navigation
  const storeIdeas = useSystemStore((s) => s.scanResults);
  const currentScanId = useSystemStore((s) => s.currentScanId);
  const scanPhase = useSystemStore((s) => s.scanPhase);
  const isRunning = scanPhase === 'running';

  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [scanProgress, setScanProgress] = useState(isRunning ? 50 : 0);
  const [currentAgentKey, setCurrentAgentKey] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<CategoryKey | 'all'>('all');

  // Map store ideas to display format
  const ideas: ScanIdea[] = useMemo(() =>
    storeIdeas.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description ?? '',
      category: (i.category as CategoryKey) || 'technical',
      agentKey: i.scan_type,
      effort: i.effort != null && i.effort <= 2 ? 'low' : i.effort != null && i.effort >= 4 ? 'high' : 'medium',
      impact: i.impact != null && i.impact <= 2 ? 'low' : i.impact != null && i.impact >= 4 ? 'high' : 'medium',
      risk: i.risk != null && i.risk <= 2 ? 'low' : i.risk != null && i.risk >= 4 ? 'high' : 'medium',
    })),
  [storeIdeas]);

  const history: ScanHistoryEntry[] = [];

  // Listen for streaming events — works even when navigating back to a running scan
  useEffect(() => {
    const outputPromise = listen<{ job_id: string; line: string }>('idea-scan-output', (event) => {
      if (currentScanId && event.payload.job_id === currentScanId) {
        if (event.payload.line.startsWith('[Idea')) {
          setScanProgress((p) => Math.min(p + 3, 95));
        }
      }
    });

    const statusPromise = listen<{ job_id: string; status: string }>('idea-scan-status', (event) => {
      if (currentScanId && event.payload.job_id === currentScanId) {
        const { status } = event.payload;
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          // Fetch ideas after completion
          if (status === 'completed') {
            const pid = useSystemStore.getState().activeProjectId;
            if (pid) useSystemStore.getState().fetchIdeas(pid);
          }
          setScanProgress(100);
          setCurrentAgentKey(null);
          // Update store phase — this drives isRunning via scanPhase
          setTimeout(() => {
            useSystemStore.setState({
              scanPhase: status === 'completed' ? 'complete' : 'error',
              currentScanId: null,
            });
            setScanProgress(0);
          }, 1000);
        }
      }
    });

    return () => {
      outputPromise.then((fn) => fn());
      statusPromise.then((fn) => fn());
    };
  }, [currentScanId]);

  const toggleAgent = (key: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedAgents.size === SCAN_AGENTS.length) {
      setSelectedAgents(new Set());
    } else {
      setSelectedAgents(new Set(SCAN_AGENTS.map((a) => a.key)));
    }
  };

  const handleRunScan = useCallback(async () => {
    if (selectedAgents.size === 0) return;
    setScanProgress(5);
    setCurrentAgentKey([...selectedAgents][0] ?? null);

    try {
      await runScan([...selectedAgents]);
      // scanPhase is now "running" in the store → isRunning becomes true
    } catch {
      setScanProgress(0);
    }
  }, [selectedAgents, runScan]);

  // Group agents by category
  const agentsByCategory = useMemo(() => {
    const map = new Map<string, ScanAgentDef[]>();
    for (const agent of SCAN_AGENTS) {
      const list = map.get(agent.categoryGroup) ?? [];
      list.push(agent);
      map.set(agent.categoryGroup, list);
    }
    return map;
  }, []);

  const filteredIdeas = filterCategory === 'all'
    ? ideas
    : ideas.filter((i) => i.category === filterCategory);

  const currentAgent = SCAN_AGENTS.find((a) => a.key === currentAgentKey) ?? null;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Lightbulb className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Idea Scanner"
        subtitle="Run specialized agents to generate improvement ideas"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={toggleAll}
            >
              {selectedAgents.size === SCAN_AGENTS.length ? 'Clear All' : 'Select All'}
            </Button>
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              icon={<Play className="w-3.5 h-3.5" />}
              disabled={selectedAgents.size === 0 || isRunning}
              loading={isRunning}
              onClick={handleRunScan}
            >
              Run Scan ({selectedAgents.size})
            </Button>
          </div>
        }
      />

      <ContentBody>
        <div className="space-y-6">
          {/* Scan progress */}
          <AnimatePresence>
            {isRunning && (
              <ScanProgress running={isRunning} currentAgent={currentAgent} progress={scanProgress} />
            )}
          </AnimatePresence>

          {/* Agent selection grid */}
          <div className="space-y-5">
            {AGENT_CATEGORIES.map((cat) => {
              const agents = agentsByCategory.get(cat.key) ?? [];
              const catTw = CATEGORY_TW[cat.key] ?? DEFAULT_CAT_TW;
              if (agents.length === 0) return null;
              return (
                <div key={cat.key}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2.5 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${catTw.dot}`} />
                    {cat.label}
                  </h3>
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                    {agents.map((agent) => (
                      <AgentCard
                        key={agent.key}
                        agent={agent}
                        selected={selectedAgents.has(agent.key)}
                        onToggle={() => toggleAgent(agent.key)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Results section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                Results ({ideas.length} idea{ideas.length !== 1 ? 's' : ''})
              </h3>
              {/* Category filter tabs */}
              <div className="flex items-center gap-1">
                <Button
                  variant={filterCategory === 'all' ? 'secondary' : 'ghost'}
                  size="xs"
                  onClick={() => setFilterCategory('all')}
                  className={filterCategory === 'all' ? 'bg-primary/15 border-primary/30' : ''}
                >
                  All
                </Button>
                {AGENT_CATEGORIES.map((cat) => {
                  const catTw = CATEGORY_TW[cat.key] ?? DEFAULT_CAT_TW;
                  return (
                    <Button
                      key={cat.key}
                      variant={filterCategory === cat.key ? 'secondary' : 'ghost'}
                      size="xs"
                      onClick={() => setFilterCategory(cat.key as CategoryKey)}
                      className={filterCategory === cat.key ? `${catTw.bg} ${catTw.border} ${catTw.text}` : ''}
                    >
                      {cat.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            {filteredIdeas.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-primary/10 rounded-xl">
                <Lightbulb className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground/50">
                  {ideas.length === 0
                    ? 'No scan results yet. Select agents above and run a scan.'
                    : 'No ideas match this filter.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {filteredIdeas.map((idea, i) => (
                  <IdeaCard key={idea.id} idea={idea} index={i} />
                ))}
              </div>
            )}
          </div>

          {/* Scan history */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">
              Scan History
            </h3>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground/40">No previous scans.</p>
            ) : (
              <div className="space-y-1">
                {history.map((entry) => {
                  const agent = SCAN_AGENTS.find((a) => a.key === entry.agentKey);
                  return (
                    <div key={entry.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-primary/5 transition-colors">
                      <span className="text-sm">{agent?.emoji ?? '?'}</span>
                      <span className="text-xs text-foreground/70 flex-1">{agent?.label ?? entry.agentKey}</span>
                      <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                        <BarChart3 className="w-3 h-3" />
                        {entry.ideaCount} ideas
                      </span>
                      <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {entry.timestamp}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
