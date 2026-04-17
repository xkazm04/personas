import { useState, useEffect, useCallback } from 'react';
import { Play, CheckCircle2, XCircle, Clock, Loader2, RotateCcw } from 'lucide-react';
import { listExecutions } from '@/api/agents/executions';
import { useAgentStore } from '@/stores/agentStore';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { useTranslation } from '@/i18n/useTranslation';

const STATUS_STYLES: Record<string, { icon: typeof CheckCircle2; color: string; bg: string }> = {
  completed: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  success: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  failed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
  error: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
  running: { icon: Loader2, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  pending: { icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
};

const DEFAULT_STYLE = { icon: Clock, color: 'text-foreground', bg: 'bg-secondary/30' };

export default function OpsRunPanel({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const [executions, setExecutions] = useState<PersonaExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const isExecuting = useAgentStore((s) => s.isExecuting);
  const sendMessage = useAgentStore((s) => s.sendChatMessage);
  const activeChatSessionId = useAgentStore((s) => s.activeChatSessionId);
  const startNewSession = useAgentStore((s) => s.startNewChatSession);

  const fetchRecent = useCallback(async () => {
    try {
      const list = await listExecutions(personaId, 5);
      setExecutions(list);
    } catch {
      // silently fail — panel is supplemental
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => { fetchRecent(); }, [fetchRecent]);

  // Refresh when execution state changes
  useEffect(() => {
    if (!isExecuting) {
      const timer = setTimeout(fetchRecent, 1500);
      return () => clearTimeout(timer);
    }
  }, [isExecuting, fetchRecent]);

  const handleExecute = useCallback(async () => {
    let sessionId = activeChatSessionId;
    if (!sessionId) {
      sessionId = await startNewSession(personaId);
      if (!sessionId) return;
    }
    sendMessage(personaId, sessionId, 'Execute this agent now. After execution, summarize the result.');
  }, [personaId, activeChatSessionId, startNewSession, sendMessage]);

  return (
    <div className="p-3 space-y-3" data-testid="ops-run-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="typo-label text-foreground">{t.agents.ops.run}</h3>
        <button
          onClick={fetchRecent}
          className="p-1 rounded-input text-foreground hover:text-muted-foreground/70 hover:bg-primary/5 transition-colors"
          title={t.common.refresh}
          aria-label={t.agents.ops_run.refresh_executions}
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>

      {/* Execute button */}
      <button
        onClick={handleExecute}
        disabled={isExecuting}
        data-testid="ops-run-execute-btn"
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-card text-sm font-medium transition-all bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isExecuting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t.agents.ops_run.running}
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            {t.agents.ops_run.execute_agent}
          </>
        )}
      </button>

      {/* Recent executions */}
      <div className="space-y-1.5">
        <h4 className="text-[11px] text-foreground font-medium uppercase tracking-wider">{t.agents.ops_run.recent}</h4>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : executions.length === 0 ? (
          <p className="text-xs text-foreground text-center py-4">{t.agents.ops_run.no_executions}</p>
        ) : (
          executions.map((exec) => {
            const style = STATUS_STYLES[exec.status] ?? DEFAULT_STYLE;
            const Icon = style.icon;
            const duration = exec.duration_ms ? `${(exec.duration_ms / 1000).toFixed(1)}s` : '—';
            const ts = exec.started_at ?? exec.created_at;
            const time = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const date = new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
            return (
              <div
                key={exec.id}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-card ${style.bg} transition-colors`}
                data-testid={`ops-run-exec-${exec.id}`}
              >
                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${style.color} ${exec.status === 'running' ? 'animate-spin' : ''}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium capitalize ${style.color}`}>{exec.status}</span>
                    <span className="text-[11px] text-foreground">{duration}</span>
                  </div>
                  <span className="text-[11px] text-foreground">{date} {time}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
