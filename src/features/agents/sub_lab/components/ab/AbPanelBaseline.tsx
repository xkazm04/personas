import { ChevronDown } from 'lucide-react';
import { DiffViewer } from '@/features/agents/sub_lab/shared';
import { AbHistory } from './AbHistory';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { ModelToggleGrid, UseCaseFilterPicker, LabPanelShell } from '../../shared';
import { useTranslation } from '@/i18n/useTranslation';
import { useMemo } from 'react';
import { useAbPanelState } from './useAbPanelState';

export function AbPanelBaseline() {
  const { t } = useTranslation();
  const s = useAbPanelState();

  const versionOptions = useMemo(
    () => s.promptVersions.map((v) => ({ value: v.id, label: `v${v.version_number} -- ${v.tag}` })),
    [s.promptVersions],
  );

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
      <LabPanelShell
        isRunning={s.isLabRunning}
        onStart={() => void s.handleStart()}
        onCancel={() => void s.handleCancel()}
        disabled={!s.versionAId || !s.versionBId || s.selectedModels.size === 0}
        disabledReason={!s.versionAId ? t.agents.lab.select_version_a : !s.versionBId ? t.agents.lab.select_version_b : s.selectedModels.size === 0 ? t.agents.lab.select_model : ''}
        runLabel={t.agents.lab.run_ab_test}
        cancelLabel={t.agents.lab.cancel_ab_test}
        cancelTestId="ab-cancel-btn"
        runTestId="ab-run-btn"
      >
        <div className="grid grid-cols-2 gap-3">
          {renderVersionPicker(t.agents.lab.version_a, 'blue', s.versionAId, s.setVersionAId, 'ab-version-a-trigger')}
          {renderVersionPicker(t.agents.lab.version_b, 'violet', s.versionBId, s.setVersionBId, 'ab-version-b-trigger')}
        </div>

        {s.versionA && s.versionB && (
          <div className="rounded-card border border-primary/10 bg-secondary/10 p-3">
            <DiffViewer versionA={s.versionA} versionB={s.versionB} />
          </div>
        )}

        <ModelToggleGrid selectedModels={s.selectedModels} toggleModel={s.toggleModel} />
        <UseCaseFilterPicker selectedUseCaseId={s.selectedUseCaseId} setSelectedUseCaseId={s.setSelectedUseCaseId} />

        <div className="space-y-1">
          <label className="typo-body text-foreground">{t.agents.lab.test_input_label}</label>
          <textarea value={s.testInput} onChange={(e) => s.setTestInput(e.target.value)} placeholder='{"task": "Summarize the latest sales report"}'
            className="w-full h-20 px-3 py-2 typo-code bg-background/50 border border-primary/20 rounded-modal text-foreground placeholder-muted-foreground/30 focus-ring resize-none font-mono disabled:opacity-50" />
        </div>
      </LabPanelShell>

      <AbHistory runs={s.abRuns} resultsMap={s.abResultsMap} expandedRunId={s.expandedRunId} onToggleExpand={s.setExpandedRunId} onDelete={(id) => void s.deleteAbRun(id)} />
    </div>
  );
}
