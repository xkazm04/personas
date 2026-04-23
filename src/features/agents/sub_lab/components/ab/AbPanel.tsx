import { useState, useMemo, useEffect } from 'react';
import { ChevronDown, LayoutDashboard, Swords, GitCompare } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { DiffViewer } from '@/features/agents/sub_lab/shared';
import { AbHistory } from './AbHistory';
import type { AbVariant } from './AbResultsView';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';
import { ModelToggleGrid, UseCaseFilterPicker, LabPanelShell } from '../../shared';
import { useTranslation } from '@/i18n/useTranslation';

const VARIANT_TABS: Array<{ id: AbVariant; label: string; subtitle: string; icon: typeof LayoutDashboard }> = [
  { id: 'baseline', label: 'Baseline', subtitle: 'Scorecard dashboard', icon: LayoutDashboard },
  { id: 'versus',   label: 'Versus',   subtitle: 'Tale of the tape',    icon: Swords },
  { id: 'diff',     label: 'Diff',     subtitle: 'Code-review view',    icon: GitCompare },
];

export function AbPanel() {
  const { t } = useTranslation();
  const promptVersions = useAgentStore((s) => s.promptVersions);
  const abRuns = useAgentStore((s) => s.abRuns);
  const abResultsMap = useAgentStore((s) => s.abResultsMap);
  const isLabRunning = useAgentStore((s) => s.isLabRunning);
  const fetchVersions = useAgentStore((s) => s.fetchVersions);
  const fetchAbRuns = useAgentStore((s) => s.fetchAbRuns);
  const startAb = useAgentStore((s) => s.startAb);
  const cancelAb = useAgentStore((s) => s.cancelAb);
  const fetchAbResults = useAgentStore((s) => s.fetchAbResults);
  const deleteAbRun = useAgentStore((s) => s.deleteAbRun);
  const abPreselectedA = useAgentStore((s) => s.abPreselectedA);
  const abPreselectedB = useAgentStore((s) => s.abPreselectedB);
  const setAbPreselect = useAgentStore((s) => s.setAbPreselect);

  const {
    selectedPersona, selectedModels, toggleModel,
    expandedRunId, setExpandedRunId,
    setActiveRunId,
    selectedUseCaseId, setSelectedUseCaseId,
    handleCancel,
  } = usePanelRunState({
    fetchRuns: (pid) => { fetchVersions(pid); fetchAbRuns(pid); },
    fetchResults: fetchAbResults,
    cancelRun: cancelAb,
  });

  const [versionAId, setVersionAId] = useState<string | null>(abPreselectedA);
  const [versionBId, setVersionBId] = useState<string | null>(abPreselectedB);
  const [testInput, setTestInput] = useState('');
  const [variant, setVariant] = useState<AbVariant>('baseline');

  // Consume pre-selected versions from deep-links
  useEffect(() => {
    if (abPreselectedA || abPreselectedB) {
      if (abPreselectedA) setVersionAId(abPreselectedA);
      if (abPreselectedB) setVersionBId(abPreselectedB);
      setAbPreselect(null, null);
    }
  }, [abPreselectedA, abPreselectedB, setAbPreselect]);

  const versionA = useMemo(() => promptVersions.find((v) => v.id === versionAId) ?? null, [promptVersions, versionAId]);
  const versionB = useMemo(() => promptVersions.find((v) => v.id === versionBId) ?? null, [promptVersions, versionBId]);

  const versionOptions = useMemo(() => promptVersions.map((v) => ({ value: v.id, label: `v${v.version_number} -- ${v.tag}` })), [promptVersions]);

  const handleStart = async () => {
    if (!selectedPersona || !versionAId || !versionBId || selectedModels.size === 0) return;
    const models = selectedModelsToConfigs(selectedModels);
    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startAb(selectedPersona.id, versionAId, versionBId, models, useCaseFilter, testInput.trim() || undefined);
    if (runId) setActiveRunId(runId);
  };

  const renderVersionPicker = (label: string, color: string, value: string | null, onChange: (v: string) => void, testId: string) => (
    <div className="space-y-1">
      <label className={`typo-body font-medium text-${color}-400`}>{label}</label>
      <Listbox itemCount={versionOptions.length} onSelectFocused={(idx) => { const opt = versionOptions[idx]; if (opt) onChange(opt.value); }} ariaLabel={`Select ${label}`}
        renderTrigger={({ isOpen, toggle }) => (
          <button onClick={toggle} data-testid={testId}

            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-modal typo-caption border transition-all ${isOpen ? `bg-${color}-500/10 border-${color}-500/30` : 'bg-background/30 border-primary/10 hover:border-primary/20'}`}>
            <span className="text-foreground">{versionOptions.find((o) => o.value === value)?.label ?? t.agents.lab.select_version}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        )}>
        {({ close, focusIndex }) => (
          <div className="py-1 bg-background border border-primary/20 rounded-card shadow-elevation-3 mt-1 max-h-48 overflow-y-auto">
            {versionOptions.map((opt, i) => (
              <button key={opt.value} data-testid={`ab-version-opt-${opt.label.replace(/\s+/g, '-').toLowerCase()}`} onClick={() => { onChange(opt.value); close(); }}
                className={`w-full text-left px-3 py-1.5 typo-body transition-colors ${focusIndex === i ? 'bg-primary/15 text-foreground' : ''} ${value === opt.value ? `text-${color}-400 font-medium` : 'text-foreground hover:bg-secondary/30'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </Listbox>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Prototype variant switcher — results-view presentation toggle */}
      <div className="flex items-center gap-1 pb-2 border-b border-primary/10">
        {VARIANT_TABS.map(({ id, label, subtitle, icon: Icon }) => {
          const active = variant === id;
          return (
            <button
              key={id}
              onClick={() => setVariant(id)}
              className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-modal transition-colors border ${
                active
                  ? 'bg-primary/10 text-foreground border-primary/20'
                  : 'text-foreground/80 hover:bg-secondary/30 border-transparent'
              }`}
            >
              <span className="flex items-center gap-1.5 typo-body font-medium">
                <Icon className="w-3.5 h-3.5" />
                {label}
              </span>
              <span className="text-[10px] text-foreground/60 font-mono tracking-wide">{subtitle}</span>
            </button>
          );
        })}
      </div>

      <LabPanelShell
        isRunning={isLabRunning}
        onStart={() => void handleStart()}
        onCancel={() => void handleCancel()}
        disabled={!versionAId || !versionBId || selectedModels.size === 0}
        disabledReason={!versionAId ? t.agents.lab.select_version_a : !versionBId ? t.agents.lab.select_version_b : selectedModels.size === 0 ? t.agents.lab.select_model : ''}
        runLabel={t.agents.lab.run_ab_test}
        cancelLabel={t.agents.lab.cancel_ab_test}
        cancelTestId="ab-cancel-btn"
        runTestId="ab-run-btn"
      >
        <div className="grid grid-cols-2 gap-3">
          {renderVersionPicker(t.agents.lab.version_a, 'blue', versionAId, setVersionAId, 'ab-version-a-trigger')}
          {renderVersionPicker(t.agents.lab.version_b, 'violet', versionBId, setVersionBId, 'ab-version-b-trigger')}
        </div>

        {versionA && versionB && (
          <div className="rounded-card border border-primary/10 bg-secondary/10 p-3">
            <DiffViewer versionA={versionA} versionB={versionB} />
          </div>
        )}

        <ModelToggleGrid selectedModels={selectedModels} toggleModel={toggleModel} />
        <UseCaseFilterPicker selectedUseCaseId={selectedUseCaseId} setSelectedUseCaseId={setSelectedUseCaseId} />

        <div className="space-y-1">
          <label className="typo-body text-foreground">{t.agents.lab.test_input_label}</label>
          <textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} placeholder='{"task": "Summarize the latest sales report"}'
            className="w-full h-20 px-3 py-2 typo-code bg-background/50 border border-primary/20 rounded-modal text-foreground placeholder-muted-foreground/30 focus-ring resize-none font-mono disabled:opacity-50" />
        </div>
      </LabPanelShell>

      <AbHistory runs={abRuns} resultsMap={abResultsMap} expandedRunId={expandedRunId} onToggleExpand={setExpandedRunId} onDelete={(id) => void deleteAbRun(id)} variant={variant} />
    </div>
  );
}
