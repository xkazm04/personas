import { useState } from 'react';
import { Bot, ExternalLink, Square, X } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import type { BackgroundExecution } from '@/stores/slices/agents/executionSlice';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { backgroundLaneActions, backgroundSummary, openBackgroundRun } from './backgroundRuns';

const STATUS_DOT: Record<BackgroundExecution['status'], string> = {
  running: 'bg-blue-400 animate-pulse',
  queued: 'bg-amber-400',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
  cancelled: 'bg-amber-400',
};

/**
 * Background runs in the execution mini player. A run started while another is
 * focused lands here: each lane can be stopped while live, opened in the
 * executions list, and dismissed once terminal. Failed lanes stay until
 * dismissed (see backgroundRuns.ts).
 */
export function BackgroundRunsBar() {
  const { t, tx } = useTranslation();
  const runs = useAgentStore((s) => s.backgroundExecutions);
  const cancelBackgroundExecution = useAgentStore((s) => s.cancelBackgroundExecution);
  const removeBackgroundExecution = useAgentStore((s) => s.removeBackgroundExecution);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (runs.length === 0) return null;

  const summary = backgroundSummary(runs);
  const selected = runs.find((r) => r.executionId === selectedId) ?? null;
  const actions = selected ? backgroundLaneActions(selected) : null;

  return (
    <div className="border-b border-primary/5 bg-secondary/10" data-testid="background-runs-bar">
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <span className="typo-caption uppercase tracking-wider text-foreground mr-1">{t.execution.background}</span>
        {runs.map((bg) => {
          const isSelected = bg.executionId === selectedId;
          return (
            <Tooltip key={bg.executionId} content={`${bg.personaName}: ${tokenLabel(t, 'execution', bg.status)}`}>
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={`${bg.personaName}: ${tokenLabel(t, 'execution', bg.status)}`}
                data-testid={`background-run-${bg.executionId}`}
                onClick={() => setSelectedId(isSelected ? null : bg.executionId)}
                className={`relative w-5 h-5 rounded-input flex items-center justify-center flex-shrink-0 transition-shadow ${
                  isSelected ? 'ring-1 ring-primary/60' : ''
                }`}
                style={{ background: `${bg.personaColor}20`, border: `1px solid ${bg.personaColor}40` }}
              >
                <Bot className="w-2.5 h-2.5" style={{ color: bg.personaColor }} />
                <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-background ${STATUS_DOT[bg.status]}`} />
              </button>
            </Tooltip>
          );
        })}
        <span className="ml-auto flex items-center gap-2 typo-caption tabular-nums">
          {summary.running > 0 && (
            <span className="text-blue-400">{tx(t.execution.bg_running, { count: summary.running })}</span>
          )}
          {summary.failed > 0 && (
            <span className="text-red-400">{tx(t.execution.bg_failed, { count: summary.failed })}</span>
          )}
        </span>
      </div>

      {selected && actions && (
        <div className="flex items-center gap-1.5 px-3 pb-1.5" data-testid="background-run-actions">
          <span className="typo-body text-foreground truncate min-w-0 flex-1">
            {selected.personaName}
            <span className="text-foreground">{` · ${tokenLabel(t, 'execution', selected.status)}`}</span>
          </span>
          {actions.stop && (
            <AsyncButton
              variant="ghost"
              size="xs"
              icon={<Square className="w-3 h-3" />}
              onClick={() => cancelBackgroundExecution(selected.executionId)}
              className="text-red-400/80 hover:text-red-400 hover:bg-red-500/15"
              data-testid="background-run-stop"
            >
              {t.execution.bg_stop}
            </AsyncButton>
          )}
          {actions.open && (
            <Button
              variant="ghost"
              size="xs"
              icon={<ExternalLink className="w-3 h-3" />}
              onClick={() => openBackgroundRun(selected.executionId)}
              data-testid="background-run-open"
            >
              {t.execution.bg_open}
            </Button>
          )}
          {actions.dismiss && (
            <Button
              variant="ghost"
              size="xs"
              icon={<X className="w-3 h-3" />}
              onClick={() => {
                removeBackgroundExecution(selected.executionId);
                setSelectedId(null);
              }}
              data-testid="background-run-dismiss"
            >
              {t.common.dismiss}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
