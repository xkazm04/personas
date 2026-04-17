import { useState, useEffect, useCallback } from 'react';
import { Swords, CheckCircle2, RefreshCw, Dna } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useOverviewStore } from '@/stores/overviewStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
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
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [slotCount, setSlotCount] = useState(3);
  const [creating, setCreating] = useState(false);
  const [strategies, setStrategies] = useState<StrategyPreset[]>([]);

  const regenerate = useCallback(() => {
    setStrategies(generateStrategies(slotCount, previousWinnerGenes));
  }, [slotCount, previousWinnerGenes]);

  // Reset form fields and strategies when modal opens
  useEffect(() => { if (open) { setTitle(''); setDescription(''); setStrategies(generateStrategies(slotCount, previousWinnerGenes)); } },
    [open], // only on open transition
  );

  // Regenerate strategies when slot count changes while modal is open
  useEffect(() => { if (open) { regenerate(); } },
    [slotCount], // slotCount drives regenerate identity
  );

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

  return (
    <BaseModal isOpen={open} onClose={onClose} titleId="new-competition-title" size="lg">
      <div className="flex flex-col overflow-hidden max-h-[85vh]">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10 bg-primary/5">
          <div className="w-9 h-9 rounded-card bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <Swords className="w-4 h-4 text-violet-400" />
          </div>
          <h2 id="new-competition-title" className="typo-section-title">
            {t.plugins.dev_lifecycle.new_competition_modal_title}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="typo-caption text-primary uppercase tracking-wider block mb-1.5">{t.plugins.dev_tools.task_title}</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
              placeholder={t.plugins.dev_lifecycle.competition_title_placeholder}
              className="w-full px-3 py-2 rounded-interactive bg-background/60 border border-primary/15 typo-body text-foreground placeholder:text-foreground focus-ring" />
          </div>
          <div>
            <label className="typo-caption text-primary uppercase tracking-wider block mb-1.5">{t.plugins.dev_tools.task_description}</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              placeholder={t.plugins.dev_lifecycle.competition_desc_placeholder}
              className="w-full px-3 py-2 rounded-interactive bg-background/60 border border-primary/15 typo-body text-foreground placeholder:text-foreground focus-ring resize-none" />
          </div>

          <div className="flex items-center justify-between">
            <label className="typo-caption text-primary uppercase tracking-wider">{t.plugins.dev_tools.competitors_dot}</label>
            <div className="flex items-center gap-2">
              {[2, 3, 4].map((n) => (
                <button key={n} onClick={() => setSlotCount(n)}
                  className={`w-8 h-8 rounded-interactive typo-heading transition-colors ${
                    slotCount === n ? 'bg-violet-500/15 text-violet-400 border border-violet-500/25'
                    : 'text-foreground hover:bg-secondary/40 border border-transparent'
                  }`}>{n}</button>
              ))}
              <button onClick={regenerate} title={t.plugins.dev_lifecycle.regenerate_strategies_title}
                className="p-1.5 rounded-interactive hover:bg-secondary/40 text-foreground ml-2">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {strategies.map((s, i) => (
              <div key={i} className="rounded-interactive border border-primary/15 bg-card/30 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Dna className="w-3.5 h-3.5 text-violet-400" />
                  <span className="typo-card-label">{s.label}</span>
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
              {t.plugins.dev_tools.first_slot_bias}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/10 bg-primary/5">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={creating}>{t.common.cancel}</Button>
          <Button variant="accent" accentColor="violet" size="sm" icon={<Swords className="w-3.5 h-3.5" />}
            onClick={handleCreate} loading={creating} disabled={!title.trim()}>
            {t.plugins.dev_lifecycle.start_competition_slots} ({slotCount} {t.plugins.dev_lifecycle.slots_suffix})
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
