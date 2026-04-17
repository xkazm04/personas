import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Swords, Trophy, Clock, Loader2, CheckCircle2, XCircle,
  Plus, RefreshCw, Ban, Star,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import {
  listCompetitions,
  getCompetition,
  startCompetition,
  pickCompetitionWinner,
  cancelCompetition,
  type CompetitionDetail,
} from '@/api/devTools/devTools';
import type { DevCompetition } from '@/lib/bindings/DevCompetition';
import type { CompetitionSlotInput } from '@/lib/bindings/CompetitionSlotInput';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Predefined strategy slots — concrete enough to force different diffs
// ---------------------------------------------------------------------------

interface StrategyPreset {
  label: string;
  prompt: string;
  tagline: string;
}

const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    label: 'Minimal',
    tagline: 'Smallest possible change',
    prompt:
      'Make the SMALLEST possible change that solves the task. No refactors, no renames, no style changes. If you see tempting cleanup, resist. Keep the diff under 50 lines if at all possible.',
  },
  {
    label: 'Test-first',
    tagline: 'Red-green-refactor',
    prompt:
      'Write FAILING tests FIRST that describe the desired behavior. Only then write the implementation. Every new function must have at least one test. The PR description must list what tests were added.',
  },
  {
    label: 'Refactor-ready',
    tagline: 'Fix smells in scope',
    prompt:
      'When you see code duplication, unclear names, or a function that should be split — fix it if it is in the immediate blast radius of this task. Do not refactor outside scope, but do clean up what you touch.',
  },
  {
    label: 'Perf-aware',
    tagline: 'Measure before changing',
    prompt:
      'Consider performance implications. Look for hot paths affected by this change. If your change could impact loop performance, DB queries, or render paths, add a brief benchmark note to the PR description.',
  },
];

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

function statusBadge(status: string): { color: string; label: string } {
  switch (status) {
    case 'running':
      return { color: 'bg-blue-500/15 text-blue-400 border-blue-500/25', label: 'Running' };
    case 'awaiting_review':
      return { color: 'bg-amber-500/15 text-amber-400 border-amber-500/25', label: 'Awaiting review' };
    case 'resolved':
      return { color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25', label: 'Resolved' };
    case 'cancelled':
      return { color: 'bg-red-500/15 text-red-400 border-red-500/25', label: 'Cancelled' };
    default:
      return { color: 'bg-primary/10 text-foreground border-primary/15', label: status };
  }
}

// ---------------------------------------------------------------------------
// New competition modal
// ---------------------------------------------------------------------------

interface NewCompetitionModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onCreated: () => void;
}

function NewCompetitionModal({ open, onClose, projectId, onCreated }: NewCompetitionModalProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set(['Minimal', 'Test-first']));
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setSelectedSlots(new Set(['Minimal', 'Test-first']));
    }
  }, [open]);

  const toggleSlot = (label: string) => {
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else if (next.size < 4) next.add(label);
      return next;
    });
  };

  const handleCreate = useCallback(async () => {
    if (!title.trim()) {
      addToast('Task title is required', 'error');
      return;
    }
    if (selectedSlots.size < 2) {
      addToast('Pick at least 2 strategy slots', 'error');
      return;
    }
    setCreating(true);
    try {
      const slots: CompetitionSlotInput[] = STRATEGY_PRESETS
        .filter((s) => selectedSlots.has(s.label))
        .map((s) => ({ label: s.label, prompt: s.prompt }));
      await startCompetition(projectId, title.trim(), description.trim() || null, null, null, slots);
      addToast(`Competition started with ${slots.length} competitors`, 'success');
      onCreated();
      onClose();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to start competition', 'error');
    } finally {
      setCreating(false);
    }
  }, [title, description, selectedSlots, projectId, addToast, onCreated, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] rounded-card bg-background border border-primary/15 shadow-elevation-4 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-primary/10 bg-primary/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-card bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Swords className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h2 className="typo-section-title">
                {t.plugins.dev_tools.start_competition}
              </h2>
              <p className="typo-body text-foreground">
                {t.plugins.dev_tools.competition_desc}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="typo-caption text-primary uppercase tracking-wider block mb-1.5">
              {t.plugins.dev_tools.task_title}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Add rate limiting to /api/auth/login"
              className="w-full px-3 py-2 rounded-interactive bg-background/60 border border-primary/15 typo-body text-foreground placeholder:text-foreground focus-ring"
              autoFocus
            />
          </div>

          <div>
            <label className="typo-caption text-primary uppercase tracking-wider block mb-1.5">
              {t.plugins.dev_tools.task_description}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should the competitors accomplish? Constraints, target files, acceptance criteria..."
              rows={4}
              className="w-full px-3 py-2 rounded-interactive bg-background/60 border border-primary/15 typo-body text-foreground placeholder:text-foreground focus-ring resize-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="typo-caption text-primary uppercase tracking-wider">
                {t.plugins.dev_tools.strategy_slots}
              </label>
              <span className="typo-caption text-foreground">
                {selectedSlots.size}{t.plugins.dev_tools.of_4_selected}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {STRATEGY_PRESETS.map((preset) => {
                const isSelected = selectedSlots.has(preset.label);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => toggleSlot(preset.label)}
                    className={`text-left p-3 rounded-card border transition-colors ${
                      isSelected
                        ? 'border-violet-500/40 bg-violet-500/10'
                        : 'border-primary/15 bg-card/40 hover:bg-primary/5'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {isSelected ? (
                        <CheckCircle2 className="w-4 h-4 text-violet-400" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-foreground/30" />
                      )}
                      <span className="typo-card-label">
                        {preset.label}
                      </span>
                    </div>
                    <p className="typo-body text-foreground">{preset.tagline}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-interactive border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="typo-body text-foreground">
              <strong>{t.plugins.dev_tools.cost_warning}</strong> {t.plugins.dev_tools.cost_warning_detail}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/10 bg-primary/5">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={creating}>
            Cancel
          </Button>
          <Button
            variant="accent"
            accentColor="violet"
            size="sm"
            icon={<Swords className="w-3.5 h-3.5" />}
            onClick={handleCreate}
            loading={creating}
            disabled={!title.trim() || selectedSlots.size < 2}
          >
            {t.plugins.dev_tools.start_competition}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Competition detail row (expanded view of one competition)
// ---------------------------------------------------------------------------

function CompetitionCard({
  competition,
  onRefresh,
}: {
  competition: DevCompetition;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [detail, setDetail] = useState<CompetitionDetail | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getCompetition(competition.id);
      setDetail(d);
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [competition.id]);

  useEffect(() => {
    if (expanded && !detail) loadDetail();
  }, [expanded, detail, loadDetail]);

  const handlePickWinner = useCallback(async (taskId: string) => {
    setPicking(taskId);
    try {
      await pickCompetitionWinner(competition.id, taskId, null, null);
      addToast('Winner selected. Merge the winning branch when ready.', 'success');
      onRefresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to pick winner', 'error');
    } finally {
      setPicking(null);
    }
  }, [competition.id, addToast, onRefresh]);

  const handleCancel = useCallback(async () => {
    try {
      await cancelCompetition(competition.id);
      addToast('Competition cancelled', 'success');
      onRefresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Cancel failed', 'error');
    }
  }, [competition.id, addToast, onRefresh]);

  const badge = statusBadge(competition.status);
  const isFinished = competition.status === 'resolved' || competition.status === 'cancelled';

  return (
    <div className="border border-primary/15 rounded-card bg-card/30 overflow-hidden">
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/5 transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-interactive bg-violet-500/15 border border-violet-500/25 flex items-center justify-center shrink-0">
          <Swords className="w-4 h-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-card-label truncate">
            {competition.task_title}
          </p>
          <p className="typo-body text-foreground truncate">
            {competition.slot_count} {t.plugins.dev_tools.competitors_dot} {new Date(competition.created_at).toLocaleString()}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 typo-caption font-medium border shrink-0 ${badge.color}`}>
          {badge.label}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-primary/10 p-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-foreground">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              <span className="typo-body">{t.plugins.dev_tools.loading_competitors}</span>
            </div>
          ) : !detail ? (
            <p className="typo-body text-foreground">{t.plugins.dev_tools.failed_to_load_detail}</p>
          ) : (
            <>
              {detail.competition.task_description && (
                <div className="rounded-interactive bg-background/40 border border-primary/10 p-3">
                  <p className="typo-caption text-primary uppercase tracking-wider mb-1">Task</p>
                  <p className="typo-body text-foreground whitespace-pre-wrap">
                    {detail.competition.task_description}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {detail.slots.map(({ slot, task }) => {
                  const taskStatus = task?.status ?? 'unknown';
                  const isWinner = detail.competition.winner_task_id === slot.task_id;
                  const taskStatusIcon =
                    taskStatus === 'running' ? <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                    : taskStatus === 'completed' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    : taskStatus === 'failed' ? <XCircle className="w-4 h-4 text-red-400" />
                    : taskStatus === 'cancelled' ? <Ban className="w-4 h-4 text-foreground" />
                    : <Clock className="w-4 h-4 text-amber-400" />;

                  return (
                    <div
                      key={slot.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-interactive border ${
                        isWinner
                          ? 'border-emerald-500/30 bg-emerald-500/5'
                          : 'border-primary/15 bg-background/30'
                      }`}
                    >
                      {taskStatusIcon}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="typo-card-label">
                            {slot.strategy_label}
                          </span>
                          {isWinner && (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 typo-caption font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                              <Trophy className="w-3 h-3" /> Winner
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="typo-caption text-foreground">{t.plugins.dev_tools.status_label} {taskStatus}</span>
                          <span className="typo-code text-foreground">{t.plugins.dev_tools.wt_label} {slot.worktree_name}</span>
                          {task?.progress_pct != null && task.progress_pct > 0 && (
                            <span className="typo-caption text-foreground">{task.progress_pct}%</span>
                          )}
                        </div>
                      </div>
                      {!isFinished && taskStatus === 'completed' && (
                        <Button
                          variant="accent"
                          accentColor="emerald"
                          size="sm"
                          icon={<Star className="w-3.5 h-3.5" />}
                          onClick={() => handlePickWinner(slot.task_id)}
                          loading={picking === slot.task_id}
                        >
                          {t.plugins.dev_tools.pick_winner}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RefreshCw className="w-3.5 h-3.5" />}
                  onClick={loadDetail}
                >
                  Refresh
                </Button>
                {!isFinished && (
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Ban className="w-3.5 h-3.5" />}
                    onClick={handleCancel}
                  >
                    {t.plugins.dev_tools.cancel_competition}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function CompetitionPanel() {
  const { t } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const [competitions, setCompetitions] = useState<DevCompetition[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const list = await listCompetitions(activeProjectId);
      setCompetitions(list);
    } catch {
      setCompetitions([]);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const activeCompetitions = useMemo(
    () => competitions.filter((c) => c.status === 'running' || c.status === 'awaiting_review'),
    [competitions],
  );
  const pastCompetitions = useMemo(
    () => competitions.filter((c) => c.status === 'resolved' || c.status === 'cancelled'),
    [competitions],
  );

  if (!activeProjectId) {
    return (
      <div className="rounded-card border border-primary/15 bg-card/30 p-4">
        <p className="typo-body text-foreground">{t.plugins.dev_tools.select_project_for_competitions}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="typo-caption text-primary uppercase tracking-wider">
          Competitions {competitions.length > 0 && <span>({competitions.length})</span>}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
            onClick={refresh}
          >
            Refresh
          </Button>
          <Button
            variant="accent"
            accentColor="violet"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowNewModal(true)}
          >
            New Competition
          </Button>
        </div>
      </div>

      {competitions.length === 0 && !loading && (
        <div className="rounded-card border border-primary/10 bg-card/20 p-6 text-center">
          <Swords className="w-8 h-8 text-foreground mx-auto mb-2" />
          <p className="typo-body text-foreground">
            {t.plugins.dev_tools.no_competitions}
          </p>
        </div>
      )}

      {activeCompetitions.length > 0 && (
        <div className="space-y-2">
          <p className="typo-caption text-foreground">Active</p>
          {activeCompetitions.map((c) => (
            <CompetitionCard key={c.id} competition={c} onRefresh={refresh} />
          ))}
        </div>
      )}

      {pastCompetitions.length > 0 && (
        <div className="space-y-2">
          <p className="typo-caption text-foreground">Past</p>
          {pastCompetitions.map((c) => (
            <CompetitionCard key={c.id} competition={c} onRefresh={refresh} />
          ))}
        </div>
      )}

      <NewCompetitionModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        projectId={activeProjectId}
        onCreated={refresh}
      />
    </div>
  );
}
