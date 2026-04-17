import { useCallback, useState } from 'react';
import {
  Loader2, CheckCircle2, XCircle, Clock, Ban,
  Trophy, FileDiff, Eye, EyeOff, Star, FolderOpen,
  Ban as BanIcon, Play, Square, ExternalLink,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import {
  parseCompetitionSlotDiffStats,
  getCompetitionSlotDiff,
  switchToWorktree,
  startSlotServer,
  stopSlotServer,
} from '@/api/devTools/devTools';
import { useToastStore } from '@/stores/toastStore';
import { computeSlotQualityScore, qualityColor } from './qualityScore';
import type { DevCompetitionSlot } from '@/lib/bindings/DevCompetitionSlot';
import type { DevTask } from '@/lib/bindings/DevTask';

import { elapsedStr, durationStr } from './timeUtils';

interface CompetitionSlotRowProps {
  slot: DevCompetitionSlot;
  task: DevTask | null;
  isWinner: boolean;
  isFinished: boolean;
  onPickWinner: (taskId: string) => void;
  picking: string | null;
}

export function CompetitionSlotRow({
  slot,
  task,
  isWinner,
  isFinished,
  onPickWinner,
  picking,
}: CompetitionSlotRowProps) {
  const [expandedDiff, setExpandedDiff] = useState<string | 'loading' | null>(null);
  const [server, setServer] = useState<{ port: number; pid: number; url: string } | null>(null);
  const [serverLoading, setServerLoading] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const handleStartServer = useCallback(async () => {
    setServerLoading(true);
    try {
      const result = await startSlotServer(slot.id);
      setServer({ port: result.port, pid: result.pid, url: result.url });
      addToast(`Dev server started on port ${result.port}`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to start server', 'error');
    } finally { setServerLoading(false); }
  }, [slot.id, addToast]);

  const handleStopServer = useCallback(async () => {
    try {
      await stopSlotServer(slot.id);
      setServer(null);
      addToast('Dev server stopped', 'success');
    } catch { setServer(null); }
  }, [slot.id, addToast]);

  const taskStatus = task?.status ?? 'unknown';
  const isDq = slot.disqualified;
  const diffStats = parseCompetitionSlotDiffStats(slot);
  const qScore = computeSlotQualityScore(task, slot);

  const handleToggleDiff = useCallback(async () => {
    if (expandedDiff) {
      setExpandedDiff(null);
      return;
    }
    setExpandedDiff('loading');
    try {
      const diffText = await getCompetitionSlotDiff(slot.id);
      setExpandedDiff(diffText || '(empty diff)');
    } catch (err) {
      setExpandedDiff(`Error: ${err instanceof Error ? err.message : 'failed to load diff'}`);
    }
  }, [expandedDiff, slot.id]);

  const handleBrowse = useCallback(async () => {
    try {
      await switchToWorktree(slot.id);
    } catch {
      // silently ignore — user can still use Diff view
    }
  }, [slot.id]);

  const taskStatusIcon =
    isDq ? <BanIcon className="w-4 h-4 text-foreground" />
    : taskStatus === 'running' ? <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
    : taskStatus === 'completed' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
    : taskStatus === 'failed' ? <XCircle className="w-4 h-4 text-red-400" />
    : taskStatus === 'cancelled' ? <Ban className="w-4 h-4 text-foreground" />
    : <Clock className="w-4 h-4 text-amber-400" />;

  return (
    <div
      className={`rounded-interactive border overflow-hidden ${
        isWinner
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : isDq
          ? 'border-foreground/15 bg-background/20 opacity-70'
          : 'border-primary/15 bg-background/30'
      }`}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        {taskStatusIcon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="typo-card-label">
              {slot.strategy_label}
            </span>
            {isWinner && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 typo-caption font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                <Trophy className="w-3 h-3" /> Winner
              </span>
            )}
            {isDq && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 typo-caption font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25"
                title={slot.disqualify_reason ?? undefined}
              >
                <BanIcon className="w-3 h-3" /> Disqualified
              </span>
            )}
            {diffStats && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 typo-caption font-medium bg-primary/10 text-foreground border border-primary/20">
                <FileDiff className="w-3 h-3" /> {diffStats.files_changed} files
                <span className="text-emerald-400 ml-1">+{diffStats.lines_added}</span>
                <span className="text-red-400">{diffStats.lines_removed}</span>
              </span>
            )}
            {qScore && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 typo-caption font-medium border ${
                  qScore.total >= 85 ? 'bg-emerald-500/10 border-emerald-500/25'
                  : qScore.total >= 70 ? 'bg-amber-500/10 border-amber-500/25'
                  : 'bg-red-500/10 border-red-500/25'
                } ${qualityColor(qScore.total)}`}
                title={`Build: ${qScore.build}/25 · Tests: ${qScore.tests}/30 · Lint: ${qScore.lint}/20 · Review: ${qScore.review}/15 · Completion: ${qScore.completion}/10`}
              >
                Q: {qScore.total}/100
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {taskStatus === 'running' && task?.started_at && (
              <span className="typo-caption text-blue-400">
                {elapsedStr(new Date(task.started_at).getTime())} elapsed
              </span>
            )}
            {taskStatus === 'completed' && task?.started_at && task?.completed_at && (
              <span className="typo-caption text-emerald-400">
                Completed in {durationStr(task.started_at, task.completed_at)}
              </span>
            )}
            {taskStatus === 'failed' && (
              <span className="typo-caption text-red-400">Failed{task?.error ? `: ${task.error}` : ''}</span>
            )}
            {taskStatus !== 'completed' && taskStatus !== 'failed' && taskStatus !== 'running' && (
              <span className="typo-caption text-foreground">Status: {taskStatus}</span>
            )}
            {isDq && slot.disqualify_reason && (
              <span className="typo-caption text-amber-400">{slot.disqualify_reason}</span>
            )}
          </div>

          {/* Completion achievements — shown once task finishes */}
          {taskStatus === 'completed' && diffStats && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap typo-caption text-foreground">
              <span className="text-foreground">Achievements:</span>
              <span>Modified {diffStats.files_changed} file{diffStats.files_changed !== 1 ? 's' : ''}</span>
              <span className="text-emerald-400">+{diffStats.lines_added} lines</span>
              <span className="text-red-400">{diffStats.lines_removed} lines</span>
              {task?.output_lines != null && task.output_lines > 0 && (
                <span>{task.output_lines} output lines</span>
              )}
            </div>
          )}
        </div>
        {taskStatus === 'completed' && !isDq && !server && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Play className="w-3.5 h-3.5" />}
            onClick={handleStartServer}
            loading={serverLoading}
            title="Start dev server in this worktree"
          >
            Preview
          </Button>
        )}
        {server && (
          <>
            <a
              href={server.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              title={`Open ${server.url}`}
            >
              <ExternalLink className="w-3 h-3" />
              :{server.port}
            </a>
            <Button
              variant="ghost"
              size="sm"
              icon={<Square className="w-3.5 h-3.5 text-red-400" />}
              onClick={handleStopServer}
              title="Stop dev server"
            >
              Stop
            </Button>
          </>
        )}
        {taskStatus === 'completed' && !isDq && (
          <Button
            variant="ghost"
            size="sm"
            icon={<FolderOpen className="w-3.5 h-3.5" />}
            onClick={handleBrowse}
            title="Open worktree directory"
          >
            Browse
          </Button>
        )}
        {taskStatus === 'completed' && (
          <Button
            variant="ghost"
            size="sm"
            icon={expandedDiff ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            onClick={handleToggleDiff}
          >
            {expandedDiff ? 'Hide' : 'Diff'}
          </Button>
        )}
        {!isFinished && taskStatus === 'completed' && !isDq && (
          <Button
            variant="accent"
            accentColor="emerald"
            size="sm"
            icon={<Star className="w-3.5 h-3.5" />}
            onClick={() => onPickWinner(slot.task_id)}
            loading={picking === slot.task_id}
          >
            Pick winner
          </Button>
        )}
      </div>
      {expandedDiff && (
        <div className="border-t border-primary/10 bg-background/60 px-3 py-2 max-h-[300px] overflow-auto">
          {expandedDiff === 'loading' ? (
            <div className="flex items-center gap-2 text-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="typo-caption">Loading diff...</span>
            </div>
          ) : (
            <pre className="typo-code text-foreground whitespace-pre-wrap break-all">
              {expandedDiff}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
