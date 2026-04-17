import { useState, useEffect, useCallback } from 'react';
import { FlaskConical, Wand2, Dna, Sparkles, RotateCcw, CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { useTranslation } from '@/i18n/useTranslation';

interface LabRunSummary {
  mode: string;
  status: string;
  startedAt: string;
  score?: number;
}

const MODE_CONFIG: Record<string, { icon: typeof FlaskConical; color: string; label: string }> = {
  arena: { icon: FlaskConical, color: 'text-violet-400', label: 'Arena' },
  matrix: { icon: Wand2, color: 'text-amber-400', label: 'Improve' },
  breed: { icon: Dna, color: 'text-pink-400', label: 'Breed' },
  evolve: { icon: Sparkles, color: 'text-cyan-400', label: 'Evolve' },
};

const STATUS_ICON: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  completed: { icon: CheckCircle2, color: 'text-emerald-400' },
  success: { icon: CheckCircle2, color: 'text-emerald-400' },
  failed: { icon: XCircle, color: 'text-red-400' },
  running: { icon: Loader2, color: 'text-blue-400' },
  pending: { icon: Clock, color: 'text-amber-400' },
};

export default function OpsLabPanel({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const [labRuns, setLabRuns] = useState<LabRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const sendMessage = useAgentStore((s) => s.sendChatMessage);
  const activeChatSessionId = useAgentStore((s) => s.activeChatSessionId);
  const startNewSession = useAgentStore((s) => s.startNewChatSession);

  const fetchLabHistory = useCallback(async () => {
    setLoading(true);
    try {
      const versions = await invokeWithTimeout<Array<{
        id: string; tag?: string; created_at: string; change_summary?: string;
      }>>("lab_get_versions", { personaId, limit: 5 });

      setLabRuns(versions.map((v) => ({
        mode: v.tag?.includes('arena') ? 'arena' : v.tag?.includes('breed') ? 'breed' : v.tag?.includes('evolve') ? 'evolve' : 'matrix',
        status: 'completed',
        startedAt: v.created_at,
        score: undefined,
      })));
    } catch {
      setLabRuns([]);
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => { fetchLabHistory(); }, [fetchLabHistory]);

  const handleQuickLaunch = useCallback(async (mode: string) => {
    let sessionId = activeChatSessionId;
    if (!sessionId) {
      sessionId = await startNewSession(personaId);
      if (!sessionId) return;
    }
    const prompts: Record<string, string> = {
      arena: 'Start an arena test for this agent. Compare haiku vs sonnet models and report the results.',
      matrix: 'Start a matrix improvement for this agent. Focus on making the output more reliable and structured.',
    };
    sendMessage(personaId, sessionId, prompts[mode] ?? `Start a ${mode} test for this agent.`);
  }, [personaId, activeChatSessionId, startNewSession, sendMessage]);

  return (
    <div className="p-3 space-y-3" data-testid="ops-lab-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="typo-label text-foreground">{t.agents.ops.lab}</h3>
        <button
          onClick={fetchLabHistory}
          className="p-1 rounded-input text-foreground hover:text-muted-foreground/70 hover:bg-primary/5 transition-colors"
          title={t.common.refresh}
          aria-label={t.agents.ops_lab.refresh_lab}
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>

      {/* Quick launch buttons */}
      <div className="grid grid-cols-2 gap-1.5">
        {(['arena', 'matrix'] as const).map((mode) => {
          const cfg = MODE_CONFIG[mode]!;
          const Icon = cfg.icon;
          return (
            <button
              key={mode}
              onClick={() => handleQuickLaunch(mode)}
              data-testid={`ops-lab-launch-${mode}`}
              className={`flex flex-col items-center gap-1.5 p-2.5 rounded-card border border-primary/10 hover:border-primary/20 bg-primary/[0.03] hover:bg-primary/[0.06] transition-all`}
            >
              <Icon className={`w-4 h-4 ${cfg.color}`} />
              <span className="text-[11px] font-medium text-foreground">{cfg.label}</span>
            </button>
          );
        })}
      </div>

      {/* Recent lab runs */}
      <div className="space-y-1.5">
        <h4 className="text-[11px] text-foreground font-medium uppercase tracking-wider">{t.agents.ops_lab.history}</h4>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : labRuns.length === 0 ? (
          <p className="typo-caption text-foreground text-center py-4">{t.agents.ops_lab.no_lab_runs}</p>
        ) : (
          labRuns.map((run, i) => {
            const modeCfg = MODE_CONFIG[run.mode] ?? MODE_CONFIG['matrix']!;
            const ModeIcon = modeCfg.icon;
            const statusCfg = STATUS_ICON[run.status] ?? STATUS_ICON['pending']!;
            const StatusIcon = statusCfg.icon;
            const time = new Date(run.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
            return (
              <div
                key={`${run.mode}-${i}`}
                className="flex items-center gap-2 px-2.5 py-2 rounded-card bg-secondary/20"
              >
                <ModeIcon className={`w-3.5 h-3.5 flex-shrink-0 ${modeCfg.color}`} />
                <div className="flex-1 min-w-0">
                  <span className="typo-caption font-medium text-foreground">{modeCfg.label}</span>
                  <span className="text-[11px] text-foreground ml-1.5">{time}</span>
                </div>
                <StatusIcon className={`w-3 h-3 flex-shrink-0 ${statusCfg.color} ${run.status === 'running' ? 'animate-spin' : ''}`} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
