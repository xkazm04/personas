import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lightbulb, Play,
  BrainCircuit,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useDevToolsActions } from '../hooks/useDevToolsActions';
import { useSystemStore } from '@/stores/systemStore';
import {
  SCAN_AGENTS, AGENT_CATEGORIES,
} from '../constants/scanAgents';
import {
  DEFAULT_CATEGORY_TW, CATEGORY_TW,
} from '../constants/ideaColors';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { IdeaEvolutionPanel } from './IdeaEvolutionPanel';
import { AgentScoreboard } from './AgentScoreboard';
import { useOverviewStore } from '@/stores/overviewStore';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';
import {
  AgentCard, ScanProgress, IdeaCard, ScanHistoryTable,
  type CategoryKey, type ScanIdea, type ScanHistoryEntry,
} from './IdeaScannerCards';
import { matchAgentsToContext } from './ideaScannerHelpers';

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function IdeaScannerPage() {
  const { t } = useTranslation();
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
    const map = new Map<string, typeof SCAN_AGENTS[number][]>();
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
        title={t.plugins.dev_scanner.idea_scanner_title}
        subtitle={t.plugins.dev_scanner.idea_scanner_subtitle}
      />

      <ContentBody centered>
        <ActionRow left={<LifecycleProjectPicker />}>
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
            {t.plugins.dev_scanner.run_scan_btn}{selectedAgents.size})
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
            {t.plugins.dev_scanner.auto_scan}
          </Button>
        </ActionRow>

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
              className="border border-violet-500/20 bg-violet-500/5 rounded-modal p-4"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-7 h-7 rounded-card bg-violet-500/15 flex items-center justify-center">
                  <BrainCircuit className="w-4 h-4 text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-md font-medium text-foreground">{t.plugins.dev_scanner.automated_context_scan}</p>
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
                {t.plugins.dev_scanner.results_header}{ideas.length} idea{ideas.length !== 1 ? 's' : ''})
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
              <div className="text-center py-16 border border-dashed border-primary/10 rounded-modal">
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
              {t.plugins.dev_scanner.scan_history_header}{history.length})
            </h3>
            <ScanHistoryTable history={history} />
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
