import { useState, useEffect, useCallback } from 'react';
import { Swords, CheckCircle2, RefreshCw, Dna } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useOverviewStore } from '@/stores/overviewStore';
import { useToastStore } from '@/stores/toastStore';
import { startCompetition, startBatchExecution } from '@/api/devTools/devTools';
import { generateStrategies, type StrategyPreset, type StrategyGenes } from './strategyPresets';
import type { CompetitionSlotInput } from '@/lib/bindings/CompetitionSlotInput';

interface NewCompetitionModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onCreated: () => void;
  previousWinnerGenes?: StrategyGenes | null;
}

export function NewCompetitionModal({
  open, onClose, projectId, onCreated, previousWinnerGenes,
}: NewCompetitionModalProps) {
  const addToast = useToastStore((s) => s.addToast);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [slotCount, setSlotCount] = useState(3);
  const [creating, setCreating] = useState(false);
  const [strategies, setStrategies] = useState<StrategyPreset[]>([]);

  const regenerate = useCallback(() => {
    setStrategies(generateStrategies(slotCount, previousWinnerGenes));
  }, [slotCount, previousWinnerGenes]);

  useEffect(() => { if (open) { setTitle(''); setDescription(''); regenerate(); } }, [open, regenerate]);
  useEffect(() => { regenerate(); }, [slotCount, regenerate]);

  const handleCreate = useCallback(async () => {
    if (!title.trim()) { addToast('Task title is required', 'error'); return; }
    setCreating(true);
    try {
      const slots: CompetitionSlotInput[] = strategies.map((s) => ({
        label: s.label, prompt: s.prompt,
      }));
      const result = await startCompetition(
        projectId, title.trim(), description.trim() || null, null, null, slots,
      );
      const taskIds = result.slots.map((s) => s.task_id);
      if (taskIds.length > 0) {
        try { await startBatchExecution(taskIds, taskIds.length); }
        catch (e) { addToast(`Batch start failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error'); }
      }
      addToast(`Competition started with ${slots.length} competitors`, 'success');
      useOverviewStore.getState().processStarted(
        'competition', result.competition.id,
        `Competition: ${title.trim()} (${slots.length} competitors)`,
        { section: 'plugins', tab: 'lifecycle' },
      );
      onCreated(); onClose();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed', 'error');
    } finally { setCreating(false); }
  }, [title, description, strategies, projectId, addToast, onCreated, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] rounded-card bg-background border border-primary/15 shadow-elevation-4 flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10 bg-primary/5">
          <div className="w-9 h-9 rounded-card bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <Swords className="w-4 h-4 text-violet-400" />
          </div>
          <h2 className="typo-heading text-primary [text-shadow:_0_0_10px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
            Start a Competition
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="typo-caption text-foreground uppercase tracking-wider block mb-1.5">Task title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
              placeholder="e.g. Add rate limiting to /api/auth/login"
              className="w-full px-3 py-2 rounded-interactive bg-background/60 border border-primary/15 typo-body text-foreground placeholder:text-foreground/40 focus-ring" />
          </div>
          <div>
            <label className="typo-caption text-foreground uppercase tracking-wider block mb-1.5">Task description (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              placeholder="Acceptance criteria, target files, constraints..."
              className="w-full px-3 py-2 rounded-interactive bg-background/60 border border-primary/15 typo-body text-foreground placeholder:text-foreground/40 focus-ring resize-none" />
          </div>

          <div className="flex items-center justify-between">
            <label className="typo-caption text-foreground uppercase tracking-wider">Competitors</label>
            <div className="flex items-center gap-2">
              {[2, 3, 4].map((n) => (
                <button key={n} onClick={() => setSlotCount(n)}
                  className={`w-8 h-8 rounded-interactive typo-heading transition-colors ${
                    slotCount === n ? 'bg-violet-500/15 text-violet-400 border border-violet-500/25'
                    : 'text-foreground/60 hover:bg-secondary/40 border border-transparent'
                  }`}>{n}</button>
              ))}
              <button onClick={regenerate} title="Regenerate strategies"
                className="p-1.5 rounded-interactive hover:bg-secondary/40 text-foreground/60 ml-2">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {strategies.map((s, i) => (
              <div key={i} className="rounded-interactive border border-primary/15 bg-card/30 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Dna className="w-3.5 h-3.5 text-violet-400" />
                  <span className="typo-heading text-primary [text-shadow:_0_0_8px_color-mix(in_oklab,var(--primary)_35%,transparent)]">{s.label}</span>
                  <span className="typo-caption text-foreground ml-auto">{s.tagline}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {Object.entries(s.genes).map(([key, val]) => (
                    <span key={key} className={`rounded px-1.5 py-0.5 typo-caption border ${
                      (val as number) >= 7 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                      : (val as number) <= 3 ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                      : 'bg-primary/10 text-foreground border-primary/15'
                    }`}>
                      {key.replace(/([A-Z])/g, ' $1').trim()}: {val as number}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {previousWinnerGenes && (
            <div className="flex items-center gap-2 text-foreground typo-caption">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              First slot biased toward previous winner. Others explore new combinations.
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/10 bg-primary/5">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={creating}>Cancel</Button>
          <Button variant="accent" accentColor="violet" size="sm" icon={<Swords className="w-3.5 h-3.5" />}
            onClick={handleCreate} loading={creating} disabled={!title.trim()}>
            Start Competition ({slotCount} slots)
          </Button>
        </div>
      </div>
    </div>
  );
}
