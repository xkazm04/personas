import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Trash2, ChevronRight, RefreshCw, RotateCcw } from 'lucide-react';
import { listN8nSessions, deleteN8nSession, getN8nSession } from '@/api/n8nTransform';
import type { N8nTransformSession } from '@/lib/bindings/N8nTransformSession';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import type { AgentIR } from '@/lib/types/designTypes';
import type { N8nWizardStep, TransformQuestion, TransformSubPhase, SessionLoadedPayload } from './useN8nImportReducer';
import { STEP_META, WIZARD_STEPS } from './useN8nImportReducer';

interface N8nSessionListProps {
  onLoadSession: (payload: SessionLoadedPayload) => void;
}

/** Detect sessions interrupted by app exit (vs genuine failures) */
function isInterruptedSession(session: N8nTransformSession): boolean {
  return session.status === 'failed'
    && !!session.error?.includes('App closed during transform');
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft:              { bg: 'bg-zinc-500/15', text: 'text-zinc-400', label: 'Draft' },
  analyzing:          { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Analyzing' },
  transforming:       { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Transforming' },
  awaiting_answers:   { bg: 'bg-violet-500/15', text: 'text-violet-400', label: 'Needs Input' },
  editing:            { bg: 'bg-violet-500/15', text: 'text-violet-400', label: 'Editing' },
  confirmed:          { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Confirmed' },
  failed:             { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Failed' },
  interrupted:        { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Interrupted' },
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function N8nSessionList({ onLoadSession }: N8nSessionListProps) {
  const [sessions, setSessions] = useState<N8nTransformSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await listN8nSessions();
      setSessions(result);
    } catch {
      // User-facing: error is displayed inline via error state
      setError('Failed to load previous imports. Please retry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchSessions();
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await deleteN8nSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setError(null);
    } catch {
      // User-facing: error is displayed inline via error state
      setError('Failed to delete session. Please retry.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleLoad = async (session: N8nTransformSession) => {
    try {
      setError(null);
      const full = await getN8nSession(session.id);
      const parseErrors: string[] = [];

      const parseJsonField = <T,>(raw: string | null, label: string): T | null => {
        if (!raw) return null;
        try {
          return JSON.parse(raw) as T;
        } catch {
          // intentional: non-critical — JSON parse fallback
          parseErrors.push(label);
          return null;
        }
      };

      const parsedResult = parseJsonField<AgentIR>(full.parser_result, 'parser results');
      const draft = parseJsonField<N8nPersonaDraft>(full.draft_json, 'draft');
      const questions = parseJsonField<TransformQuestion[]>(full.questions_json, 'questions');
      const rawUserAnswers = parseJsonField<Record<string, string>>(full.user_answers, 'saved answers');

      const transformId = full.transform_id ?? null;

      // Map DB step to wizard step
      const stepMap: Record<string, N8nWizardStep> = {
        upload: 'upload',
        analyze: 'analyze',
        configure: 'transform',  // legacy sessions — configure merged into transform
        transform: 'transform',
        edit: 'edit',
        confirm: 'confirm',
      };

      // Smart step routing for interrupted/failed sessions
      let targetStep: N8nWizardStep;
      if (full.status === 'failed' || full.status === 'transforming') {
        if (draft) {
          targetStep = 'edit';
        } else if (parsedResult) {
          targetStep = 'analyze';
        } else {
          targetStep = 'upload';
        }
      } else if (full.status === 'awaiting_answers') {
        targetStep = 'transform';
      } else {
        targetStep = stepMap[full.step] ?? 'upload';
      }

      // Compute transform sub-phase from loaded state
      let subPhase: TransformSubPhase = 'idle';
      if (targetStep === 'transform') {
        if (draft) {
          subPhase = 'completed';
        } else if (questions && questions.length > 0) {
          subPhase = 'answering';
        }
      }

      // Merge saved answers with question defaults
      const defaultAnswers = questions
        ? questions.reduce<Record<string, string>>((acc, q) => {
            if (q.default) acc[q.id] = q.default;
            return acc;
          }, {})
        : {};
      const userAnswers = { ...defaultAnswers, ...(rawUserAnswers ?? {}) };

      onLoadSession({
        sessionId: full.id,
        step: targetStep,
        workflowName: full.workflow_name,
        rawWorkflowJson: full.raw_workflow_json,
        parsedResult,
        draft,
        questions,
        transformId,
        userAnswers,
        transformSubPhase: subPhase,
        recoveryWarning: parseErrors.length > 0
          ? `Session partially restored. Could not recover ${parseErrors.join(', ')}.`
          : null,
      });
    } catch {
      // User-facing: error is displayed inline via error state
      setError('Failed to load session. Please retry.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="w-4 h-4 text-muted-foreground/80 animate-spin" />
      </div>
    );
  }

  if (sessions.length === 0 && !error) return null;

  // Only show non-confirmed sessions (in-progress/failed)
  const activeSessions = sessions.filter((s) => s.status !== 'confirmed');
  if (activeSessions.length === 0 && !error) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground/90 uppercase tracking-wider">
          Previous Imports
        </h3>
        <span className="text-sm text-muted-foreground/80">
          {activeSessions.length} session{activeSessions.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-1.5">
        {error && (
          <div
            className="flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2"
            aria-live="polite"
          >
            <p className="text-sm text-red-400/80">{error}</p>
            <button
              type="button"
              onClick={() => void fetchSessions()}
              className="px-3 py-1.5 text-sm rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {activeSessions.map((session, i) => {
          const interrupted = isInterruptedSession(session);
          const statusKey = interrupted ? 'interrupted' : session.status;
          const style = STATUS_STYLES[statusKey] ?? STATUS_STYLES.draft!;
          return (
            <motion.div
              key={session.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.2 }}
              role="button"
              tabIndex={0}
              onClick={() => void handleLoad(session)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void handleLoad(session); } }}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-primary/10 bg-secondary/20 hover:bg-secondary/40 transition-colors text-left group cursor-pointer"
              data-testid={`n8n-session-card-${session.id}`}
            >
              <div className="w-10 h-10 rounded-lg bg-violet-500/10 border border-violet-500/15 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-mono font-medium text-violet-400">
                  {(STEP_META[session.step as N8nWizardStep]?.index ?? 0) + 1}/{WIZARD_STEPS.length}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground/90 truncate">
                  {session.workflow_name}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`px-1.5 py-0.5 text-sm font-medium rounded-lg ${style.bg} ${style.text}`}>
                    {style.label}
                  </span>
                  <span className="text-sm text-muted-foreground/80 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {formatRelativeTime(session.updated_at)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={(e) => void handleDelete(e, session.id)}
                  disabled={deletingId === session.id}
                  className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                  title="Delete session"
                  data-testid={`n8n-session-delete-${session.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                {interrupted ? (
                  <span className="flex items-center gap-1 text-sm text-amber-400 font-medium">
                    <RotateCcw className="w-3 h-3" />
                    Retry
                  </span>
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground/80 group-hover:text-muted-foreground" />
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
