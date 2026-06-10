import { useState } from 'react';
import { AlertTriangle, MoonStar, Trash2, GitMerge, Wand2, Settings } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { SettingRow } from '@/features/shared/components/forms/SettingRow';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import SavedConfigsSidebar from '../SavedConfigsSidebar';
import RevitalizeProgress from './RevitalizeProgress';
import RevitalizeSummaryCard from './RevitalizeSummaryCard';
import RevitalizeHistoryTable from './RevitalizeHistoryTable';
import { useRevitalizeJob } from './useRevitalizeJob';

export default function RevitalizePanel() {
  const { t, tx } = useTranslation();
  const ob = t.plugins.obsidian_brain;
  const addToast = useToastStore((s) => s.addToast);
  const connected = useSystemStore((s) => s.obsidianConnected);
  const vaultName = useSystemStore((s) => s.obsidianVaultName);
  const setObsidianBrainTab = useSystemStore((s) => s.setObsidianBrainTab);

  const { running, lines, error, summary, start, cancel, dismissSummary } = useRevitalizeJob();

  const [pruneStale, setPruneStale] = useState(true);
  const [mergeDuplicates, setMergeDuplicates] = useState(true);
  const [refreshStructure, setRefreshStructure] = useState(false);
  const [instructions, setInstructions] = useState('');

  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <EmptyState
          icon={AlertTriangle}
          title={ob.no_vault_connected}
          subtitle={ob.no_vault_hint}
          iconColor="text-amber-400/80"
          iconContainerClassName="bg-amber-500/10 border-amber-500/20"
          action={{ label: ob.tab_setup, onClick: () => setObsidianBrainTab('setup'), icon: Settings }}
        />
      </div>
    );
  }

  const handleStart = async () => {
    if (!pruneStale && !mergeDuplicates && !refreshStructure) {
      addToast(ob.revitalize_no_goals, 'error');
      return;
    }
    try {
      await start({
        pruneStale,
        mergeDuplicates,
        refreshStructure,
        instructions: instructions.trim() || null,
      });
      addToast(tx(ob.revitalize_started_toast, { name: vaultName ?? '' }), 'success');
    } catch (e) {
      addToast(tx(ob.revitalize_start_failed, { error: String(e) }), 'error');
    }
  };

  return (
    <div className="flex gap-4 py-2">
      <div className="flex-1 min-w-0 max-w-2xl space-y-5">
        {vaultName && (
          <div className="flex items-center gap-2 px-1">
            <span className="typo-caption text-foreground">{ob.active_vault_label}</span>
            <span className="typo-caption text-violet-300">{vaultName}</span>
          </div>
        )}

        <SectionCard
          title={ob.revitalize_title}
          subtitle={ob.revitalize_subtitle}
          titleClassName="text-primary"
        >
          <div className="space-y-4">
            <div className="space-y-3">
              {[
                { icon: <Trash2 className="w-4 h-4 text-violet-400" />, label: ob.revitalize_goal_prune, desc: ob.revitalize_goal_prune_desc, checked: pruneStale, onChange: () => setPruneStale((v) => !v), testId: 'revitalize-goal-prune' },
                { icon: <GitMerge className="w-4 h-4 text-violet-400" />, label: ob.revitalize_goal_merge, desc: ob.revitalize_goal_merge_desc, checked: mergeDuplicates, onChange: () => setMergeDuplicates((v) => !v), testId: 'revitalize-goal-merge' },
                { icon: <Wand2 className="w-4 h-4 text-violet-400" />, label: ob.revitalize_goal_refresh, desc: ob.revitalize_goal_refresh_desc, checked: refreshStructure, onChange: () => setRefreshStructure((v) => !v), testId: 'revitalize-goal-refresh' },
              ].map((opt) => (
                <SettingRow
                  key={opt.label}
                  variant="card"
                  toggleSize="sm"
                  icon={opt.icon}
                  label={opt.label}
                  description={opt.desc}
                  checked={opt.checked}
                  onChange={opt.onChange}
                  testId={opt.testId}
                />
              ))}
            </div>

            <div className="space-y-1.5">
              <label className="typo-label text-foreground/90" htmlFor="revitalize-instructions">
                {ob.revitalize_instructions_label}
              </label>
              <textarea
                id="revitalize-instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={ob.revitalize_instructions_placeholder}
                rows={2}
                disabled={running}
                className="w-full px-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground/40 focus-ring transition-all resize-y disabled:opacity-50"
              />
            </div>

            <p className="typo-caption text-foreground leading-relaxed">{ob.revitalize_safety_note}</p>

            {!running && (
              <button
                onClick={handleStart}
                data-testid="revitalize-start"
                className="flex items-center gap-2 px-6 py-2.5 rounded-modal bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 transition-colors focus-ring"
              >
                <MoonStar className="w-4 h-4" />
                {ob.revitalize_start}
              </button>
            )}
          </div>
        </SectionCard>

        {running && <RevitalizeProgress lines={lines} onCancel={() => void cancel()} />}

        {!running && error && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-modal border bg-red-500/5 border-red-500/20 animate-fade-slide-in">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="typo-body text-red-400 min-w-0 break-words">
              {tx(ob.revitalize_failed, { error })}
            </p>
          </div>
        )}

        {!running && summary && (
          <RevitalizeSummaryCard
            summary={summary}
            vaultName={vaultName}
            onRunAgain={() => {
              dismissSummary();
              void handleStart();
            }}
            onDismiss={dismissSummary}
          />
        )}

        <RevitalizeHistoryTable />
      </div>

      <SavedConfigsSidebar emptyHint={ob.saved_vaults_empty_hint_other} />
    </div>
  );
}
