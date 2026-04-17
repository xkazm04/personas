import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lightbulb, Play, CheckSquare, Square, Clock,
  BarChart3, BrainCircuit,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useDevToolsActions } from '../hooks/useDevToolsActions';
import { useSystemStore } from '@/stores/systemStore';
import { formatDuration } from '@/lib/utils/formatters';
import {
  SCAN_AGENTS, AGENT_CATEGORIES,
  type ScanAgentDef,
} from '../constants/scanAgents';
import {
  HEX_COLOR_MAP, DEFAULT_CATEGORY_TW, CATEGORY_TW, levelColor,
} from '../constants/ideaColors';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { IdeaEvolutionPanel } from './IdeaEvolutionPanel';
import { AgentScoreboard } from './AgentScoreboard';
import { useOverviewStore } from '@/stores/overviewStore';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';
import type { DevContext } from '@/lib/bindings/DevContext';
import { parseJsonArray } from '../sub_context/contextMapTypes';

// ---------------------------------------------------------------------------
// Auto-scan: match scan types to contexts based on keywords
// ---------------------------------------------------------------------------

/** Keyword patterns that map context attributes to relevant scan agents */
const SCAN_MATCH_RULES: { agentKey: string; keywords: RegExp }[] = [
  { agentKey: 'code-optimizer', keywords: /performance|render|bundle|query|slow|cache|optim/i },
  { agentKey: 'security-auditor', keywords: /auth|login|token|secret|password|credential|session|encrypt|permission/i },
  { agentKey: 'architecture-analyst', keywords: /architect|module|component|layer|service|pattern|coupling|abstract/i },
  { agentKey: 'test-strategist', keywords: /test|spec|coverage|mock|assert|e2e|integration|unit/i },
  { agentKey: 'dependency-auditor', keywords: /package|dependency|import|library|version|npm|cargo/i },
  { agentKey: 'ux-reviewer', keywords: /ui|ux|component|page|view|form|modal|button|layout|style/i },
  { agentKey: 'accessibility-checker', keywords: /a11y|accessibility|aria|wcag|screen.?reader|keyboard|contrast/i },
  { agentKey: 'mobile-specialist', keywords: /mobile|responsive|viewport|touch|swipe|tablet/i },
  { agentKey: 'error-handler', keywords: /error|exception|catch|boundary|fallback|retry|toast|alert/i },
  { agentKey: 'onboarding-designer', keywords: /onboard|wizard|setup|welcome|tutorial|getting.?started/i },
  { agentKey: 'feature-scout', keywords: /feature|roadmap|missing|todo|placeholder|future/i },
  { agentKey: 'monetization-advisor', keywords: /billing|payment|subscription|plan|pricing|tier|premium/i },
  { agentKey: 'analytics-planner', keywords: /analytics|tracking|event|metric|telemetry|log/i },
  { agentKey: 'documentation-auditor', keywords: /doc|readme|comment|api.?doc|jsdoc|guide/i },
  { agentKey: 'growth-hacker', keywords: /share|referral|invite|social|viral|notification/i },
  { agentKey: 'tech-debt-tracker', keywords: /debt|legacy|workaround|hack|deprecated|fixme|todo/i },
  { agentKey: 'innovation-catalyst', keywords: /ai|ml|machine.?learn|llm|agent|automat|innovat/i },
  { agentKey: 'risk-assessor', keywords: /risk|single.?point|scale|failover|backup|disaster|recovery/i },
  { agentKey: 'integration-planner', keywords: /api|webhook|integration|sync|external|third.?party|oauth/i },
  { agentKey: 'devops-optimizer', keywords: /ci|cd|deploy|docker|pipeline|build|monitor|infra/i },
];

function matchAgentsToContext(ctx: DevContext): string[] {
  const searchable = [
    ctx.name,
    ctx.description ?? '',
    ...parseJsonArray(ctx.keywords),
    ...parseJsonArray(ctx.tech_stack),
    ...parseJsonArray(ctx.api_surface),
    ...parseJsonArray(ctx.file_paths),
  ].join(' ');

  const matched = SCAN_MATCH_RULES
    .filter((rule) => rule.keywords.test(searchable))
    .map((rule) => rule.agentKey);

  // Always include at least architecture-analyst and code-optimizer as baseline
  if (matched.length === 0) return ['architecture-analyst', 'code-optimizer'];
  return [...new Set(matched)];
}

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
  effort: number;
  impact: number;
  risk: number;
}

interface ScanHistoryEntry {
  id: string;
  agentTypes: string;
  ideaCount: number;
  timestamp: string;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
}

function agentColor(agent: ScanAgentDef) {
  return HEX_COLOR_MAP[agent.color] ?? { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/20' };
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}


const SCAN_STATUS_STYLES: Record<string, string> = {
  complete: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  running: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  error: 'bg-red-500/15 text-red-400 border-red-500/25',
};

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function LevelBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-md font-medium border ${levelColor(value)}`}>
      {label}: {value}
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
      <span className="text-md font-medium text-foreground mb-0.5">{agent.label}</span>
      <span className="text-md text-foreground line-clamp-2 leading-relaxed">{agent.description}</span>
      <div className="absolute top-3 right-3">
        {selected ? (
          <CheckSquare className="w-4 h-4 text-amber-400" />
        ) : (
          <Square className="w-4 h-4 text-foreground" />
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
        <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center text-md">
          {currentAgent?.emoji ?? '...'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-md font-medium text-foreground">
            Scanning with {currentAgent?.label ?? '...'}
          </p>
          <p className="text-md text-foreground">
            Analyzing codebase patterns and generating ideas
          </p>
        </div>
        <span className="text-md text-amber-400 font-medium">{Math.round(progress)}%</span>
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
  const catTw = CATEGORY_TW[idea.category] ?? DEFAULT_CATEGORY_TW;
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
        <div className={`w-7 h-7 rounded-lg ${ac.bg} border ${ac.border} flex items-center justify-center text-md flex-shrink-0`}>
          {agent?.emoji ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-md font-medium text-foreground mb-0.5">{idea.title}</h4>
          <p className="text-md text-foreground line-clamp-2">{idea.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`rounded-full px-2.5 py-0.5 text-md font-medium ${catTw.bg} ${catTw.text} border ${catTw.border}`}>
          {catLabel}
        </span>
        <LevelBadge label="Effort" value={idea.effort} />
        <LevelBadge label="Impact" value={idea.impact} />
        <LevelBadge label="Risk" value={idea.risk} />
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
  const scanPhase = useSystemStore((s) => s.scanPhase);
  const isRunning = scanPhase === 'running';
  const scans = useSystemStore((s) => s.scans ?? []);
  const fetchScans = useSystemStore((s) => s.fetchScans);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);

  // Context map data for auto-scan
  const fetchContexts = useSystemStore((s) => s.fetchContexts);
  // Agent Scoreboard needs tasks to compute per-agent implementation rates —
  // pull them here so the panel has data even when the user hasn't opened
  // the Task Runner yet this session.
  const fetchTasks = useSystemStore((s) => s.fetchTasks);
  const fetchIdeas = useSystemStore((s) => s.fetchIdeas);

  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [scanProgress, setScanProgress] = useState(isRunning ? 50 : 0);
  const [currentAgentKey, setCurrentAgentKey] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<CategoryKey | 'all'>('all');
  const [autoScanRunning, setAutoScanRunning] = useState(false);
  const [autoScanStatus, setAutoScanStatus] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Map store ideas to display format
  const ideas: ScanIdea[] = useMemo(() =>
    storeIdeas.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description ?? '',
      category: (i.category as CategoryKey) || 'technical',
      agentKey: i.scan_type,
      effort: i.effort ?? 5,
      impact: i.impact ?? 5,
      risk: i.risk ?? 5,
    })),
  [storeIdeas]);

  const history: ScanHistoryEntry[] = useMemo(() =>
    scans.map((s) => ({
      id: s.id,
      agentTypes: s.scan_type,
      ideaCount: s.idea_count,
      timestamp: s.created_at,
      status: s.status,
      inputTokens: s.input_tokens,
      outputTokens: s.output_tokens,
      durationMs: s.duration_ms,
    })),
  [scans]);

  // Fetch scans + ideas + tasks when active project changes. Ideas and tasks
  // power the Agent Scoreboard's accept/impl rate aggregation; scans power
  // the history table.
  useEffect(() => {
    if (!activeProjectId) return;
    fetchScans(activeProjectId);
    fetchIdeas(activeProjectId);
    fetchTasks(activeProjectId);
  }, [activeProjectId, fetchScans, fetchIdeas, fetchTasks]);

  // Finalization helper — reads everything from store, no closure deps
  const finalizeScan = useCallback((outcome: 'success' | 'warning' | 'failed', errorMessage?: string) => {
    if (!mountedRef.current) return;
    const pid = useSystemStore.getState().activeProjectId;
    if (outcome !== 'failed' && pid) {
      useSystemStore.getState().fetchIdeas(pid);
      useSystemStore.getState().fetchScans(pid);
    }
    setScanProgress(100);
    setCurrentAgentKey(null);
    useOverviewStore.getState().processEnded('idea_scan', outcome === 'failed' ? 'failed' : 'completed');

    const center = useNotificationCenterStore.getState();
    if (outcome === 'success') {
      const ideaCount = useSystemStore.getState().ideas.length;
      center.addProcessNotification({
        processType: 'idea-scan',
        status: 'success',
        title: 'Idea Scan Completed',
        summary: ideaCount > 0
          ? `Generated ideas are ready for triage. Total ideas in backlog: ${ideaCount}.`
          : 'Scan completed. Open the page to see new ideas.',
        redirectSection: 'plugins',
        redirectTab: 'idea-scanner',
      });
    } else if (outcome === 'warning') {
      center.addProcessNotification({
        processType: 'idea-scan',
        status: 'warning',
        title: 'Idea Scan (partial)',
        summary: 'Scan exceeded the timeout but partial results were saved. Click Open to review what was generated.',
        redirectSection: 'plugins',
        redirectTab: 'idea-scanner',
      });
    } else {
      center.addProcessNotification({
        processType: 'idea-scan',
        status: 'failed',
        title: 'Idea Scan Failed',
        summary: errorMessage ?? 'The idea scan failed before any ideas were generated. Try again or check the logs.',
        redirectSection: 'plugins',
        redirectTab: 'idea-scanner',
      });
    }

    setTimeout(() => {
      if (!mountedRef.current) return;
      useSystemStore.setState({
        scanPhase: outcome === 'failed' ? 'error' : 'complete',
        currentScanId: null,
      });
      setScanProgress(0);
    }, 800);
  }, []);

  const finalizeScanRef = useRef(finalizeScan);
  useEffect(() => { finalizeScanRef.current = finalizeScan; });

  // Listen for streaming events — registered ONCE on mount.
  // Reads currentScanId from store at event time so listener is stable.
  useEffect(() => {
    let outputUnlisten: (() => void) | null = null;
    let statusUnlisten: (() => void) | null = null;

    listen<{ job_id: string; line: string }>(EventName.IDEA_SCAN_OUTPUT, (event) => {
      const id = useSystemStore.getState().currentScanId;
      if (id && event.payload.job_id === id) {
        if (event.payload.line.startsWith('[Idea')) {
          setScanProgress((p) => Math.min(p + 3, 95));
        }
      }
    }).then((fn) => { outputUnlisten = fn; });

    listen<{ job_id: string; status: string; error?: string }>(EventName.IDEA_SCAN_STATUS, (event) => {
      const id = useSystemStore.getState().currentScanId;
      if (id && event.payload.job_id === id) {
        const { status, error } = event.payload;
        if (status === 'completed') {
          finalizeScanRef.current('success');
        } else if (status === 'completed_with_warning') {
          finalizeScanRef.current('warning', error);
        } else if (status === 'failed' || status === 'cancelled') {
          finalizeScanRef.current('failed', error);
        }
      }
    }).then((fn) => { statusUnlisten = fn; });

    return () => {
      outputUnlisten?.();
      statusUnlisten?.();
    };
  }, []);

  // On mount: if a scan is already active, poll its real status to resync
  // (handles user navigating away during scan and missing completion event).
  useEffect(() => {
    const id = useSystemStore.getState().currentScanId;
    if (!id) return;

    let cancelled = false;
    (async () => {
      try {
        const { invokeWithTimeout } = await import('@/lib/tauriInvoke');
        const result = await invokeWithTimeout<{ scan_id: string; status: string; error?: string }>(
          'dev_tools_get_idea_scan_status',
          { scanId: id },
        );
        if (cancelled) return;
        if (result.status === 'completed') {
          finalizeScanRef.current('success');
        } else if (result.status === 'completed_with_warning') {
          finalizeScanRef.current('warning', result.error);
        } else if (result.status === 'failed' || result.status === 'cancelled' || result.status === 'not_found') {
          finalizeScanRef.current('failed', result.error);
        }
      } catch { /* ignore */ }
    })();

    return () => { cancelled = true; };
  }, []);

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
    useOverviewStore.getState().processStarted(
      'idea_scan',
      undefined,
      `Idea Scan (${selectedAgents.size} agents)`,
      { section: 'plugins', tab: 'idea-scanner' },
    );

    try {
      await runScan([...selectedAgents]);
    } catch {
      setScanProgress(0);
      useOverviewStore.getState().processEnded('idea_scan', 'failed');
    }
  }, [selectedAgents, runScan]);

  // Auto-scan: evaluate all contexts and run matching agents per context
  const handleAutoScan = useCallback(async () => {
    if (!activeProjectId || autoScanRunning) return;

    setAutoScanRunning(true);
    setAutoScanStatus('Loading contexts...');
    useOverviewStore.getState().processStarted(
      'auto_scan',
      undefined,
      'Automated Context Scan',
      { section: 'plugins', tab: 'idea-scanner' },
    );

    try {
      // Ensure contexts are loaded
      await fetchContexts(activeProjectId);
      const ctxList = useSystemStore.getState().contexts;

      if (ctxList.length === 0) {
        setAutoScanStatus('No contexts found. Run Context Map scan first.');
        setAutoScanRunning(false);
        useOverviewStore.getState().processEnded('auto_scan', 'failed');
        return;
      }

      let completed = 0;
      for (const ctx of ctxList) {
        if (!mountedRef.current) break;
        const matchedAgents = matchAgentsToContext(ctx);
        setAutoScanStatus(`Scanning "${ctx.name}" (${matchedAgents.length} agents) — ${completed + 1}/${ctxList.length}`);
        setScanProgress(Math.round((completed / ctxList.length) * 90) + 5);

        try {
          await runScan(matchedAgents, ctx.id);
          await new Promise<void>((resolve) => {
            const check = () => {
              if (!mountedRef.current) { resolve(); return; }
              const phase = useSystemStore.getState().scanPhase;
              if (phase !== 'running') { resolve(); return; }
              setTimeout(check, 2000);
            };
            setTimeout(check, 3000);
          });
        } catch {
          // Continue with next context on individual failure
        }
        completed++;
      }

      if (!mountedRef.current) return;

      setAutoScanStatus(`Completed! Scanned ${ctxList.length} contexts.`);
      setScanProgress(100);
      useOverviewStore.getState().processEnded('auto_scan', 'completed');

      // Refresh ideas
      useSystemStore.getState().fetchIdeas(activeProjectId);
      useSystemStore.getState().fetchScans(activeProjectId);

      setTimeout(() => {
        if (!mountedRef.current) return;
        setScanProgress(0);
        setAutoScanStatus(null);
        setAutoScanRunning(false);
      }, 2000);
    } catch {
      setAutoScanStatus('Auto-scan failed');
      setAutoScanRunning(false);
      useOverviewStore.getState().processEnded('auto_scan', 'failed');
    }
  }, [activeProjectId, autoScanRunning, fetchContexts, runScan]);

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
            <LifecycleProjectPicker />
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
              disabled={selectedAgents.size === 0 || isRunning || autoScanRunning}
              loading={isRunning && !autoScanRunning}
              onClick={handleRunScan}
            >
              Run Scan ({selectedAgents.size})
            </Button>
            <Button
              variant="accent"
              accentColor="violet"
              size="sm"
              icon={<BrainCircuit className="w-3.5 h-3.5" />}
              disabled={isRunning || autoScanRunning || !activeProjectId}
              loading={autoScanRunning}
              onClick={handleAutoScan}
            >
              Auto-Scan
            </Button>
          </div>
        }
      />

      <ContentBody centered>
        <div className="space-y-6">
          {/* Scan progress */}
          <AnimatePresence>
            {isRunning && !autoScanRunning && (
              <ScanProgress running={isRunning} currentAgent={currentAgent} progress={scanProgress} />
            )}
          </AnimatePresence>

          {/* Auto-scan progress */}
          {autoScanRunning && autoScanStatus && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="border border-violet-500/20 bg-violet-500/5 rounded-xl p-4"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
                  <BrainCircuit className="w-4 h-4 text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-md font-medium text-foreground">Automated Context Scan</p>
                  <p className="text-md text-foreground">{autoScanStatus}</p>
                </div>
                <span className="text-md text-violet-400 font-medium">{Math.round(scanProgress)}%</span>
              </div>
              <div className="w-full h-1.5 bg-primary/10 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-violet-400 rounded-full"
                  animate={{ width: `${scanProgress}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
            </motion.div>
          )}

          {/* Agent selection grid */}
          <div className="space-y-5">
            {AGENT_CATEGORIES.map((cat) => {
              const agents = agentsByCategory.get(cat.key) ?? [];
              const catTw = CATEGORY_TW[cat.key] ?? DEFAULT_CATEGORY_TW;
              if (agents.length === 0) return null;
              return (
                <div key={cat.key}>
                  <h3 className="text-md font-semibold uppercase tracking-wider text-primary mb-2.5 flex items-center gap-2">
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
              <h3 className="text-md font-semibold uppercase tracking-wider text-primary">
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
                  const catTw = CATEGORY_TW[cat.key] ?? DEFAULT_CATEGORY_TW;
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
                <Lightbulb className="w-8 h-8 text-foreground mx-auto mb-2" />
                <p className="text-md text-foreground">
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

          {/* Agent performance scoreboard — per-agent acceptance & impl rates */}
          <AgentScoreboard />

          {/* Idea Evolution */}
          <IdeaEvolutionPanel />

          {/* Scan history */}
          <div>
            <h3 className="text-md font-semibold uppercase tracking-wider text-primary mb-3">
              Scan History ({history.length})
            </h3>
            {history.length === 0 ? (
              <p className="text-md text-foreground">No previous scans.</p>
            ) : (
              <div className="border border-primary/10 rounded-xl overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_0.6fr_0.5fr_0.7fr_0.5fr_0.5fr] gap-2 px-3 py-2 bg-primary/5 border-b border-primary/10 text-md font-medium text-primary uppercase tracking-wider">
                  <span>Agents</span>
                  <span>Status</span>
                  <span>Ideas</span>
                  <span>Tokens</span>
                  <span>Duration</span>
                  <span>When</span>
                </div>
                {history.map((entry) => {
                  const agentKeys = entry.agentTypes.split(',');
                  const agentEmojis = agentKeys.map((k) => SCAN_AGENTS.find((a) => a.key === k.trim())?.emoji ?? '?').join(' ');
                  const statusStyle = SCAN_STATUS_STYLES[entry.status] ?? SCAN_STATUS_STYLES.error;
                  const totalTokens = (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
                  return (
                    <div key={entry.id} className="grid grid-cols-[1fr_0.6fr_0.5fr_0.7fr_0.5fr_0.5fr] gap-2 px-3 py-2.5 border-b border-primary/5 last:border-b-0 hover:bg-primary/5 transition-colors items-center">
                      <span className="text-md text-foreground truncate" title={agentKeys.join(', ')}>
                        {agentEmojis} <span className="text-foreground">{agentKeys.length > 1 ? `(${agentKeys.length})` : agentKeys[0]}</span>
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-md font-medium border w-fit ${statusStyle}`}>
                        {entry.status}
                      </span>
                      <span className="text-md text-foreground flex items-center gap-1">
                        <BarChart3 className="w-3.5 h-3.5 text-foreground" />
                        {entry.ideaCount}
                      </span>
                      <span className="text-md text-foreground font-mono">
                        {totalTokens > 0 ? totalTokens.toLocaleString() : '-'}
                      </span>
                      <span className="text-md text-foreground">
                        {formatDuration(entry.durationMs)}
                      </span>
                      <span className="text-md text-foreground flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {relativeTime(entry.timestamp)}
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
