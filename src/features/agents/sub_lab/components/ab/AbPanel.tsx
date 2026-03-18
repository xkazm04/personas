import { useState, useMemo, useEffect } from 'react';
import { Play, Square, ChevronDown, Filter } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useAgentStore } from "@/stores/agentStore";
import { DiffViewer } from '@/features/agents/sub_lab/shared';
import { LabProgress } from '../shared/LabProgress';
import { AbHistory } from './AbHistory';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { ANTHROPIC_MODELS, selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import { usePanelRunState } from '../../libs/usePanelRunState';

export function AbPanel() {
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

  const useCases = useSelectedUseCases();
  const useCaseOptions = useMemo(() => [{ value: '__all__', label: 'All Use Cases' }, ...useCases.map((uc) => ({ value: uc.id, label: uc.title }))], [useCases]);
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
      <label className={`text-sm font-medium text-${color}-400`}>{label}</label>
      <Listbox itemCount={versionOptions.length} onSelectFocused={(idx) => { const opt = versionOptions[idx]; if (opt) onChange(opt.value); }} ariaLabel={`Select ${label}`}
        renderTrigger={({ isOpen, toggle }) => (
          <button onClick={toggle} disabled={isLabRunning} data-testid={testId}
            title={isLabRunning ? 'Cannot change while test is running' : undefined}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm border transition-all ${isOpen ? `bg-${color}-500/10 border-${color}-500/30` : 'bg-background/30 border-primary/10 hover:border-primary/20'} ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
            <span className="text-foreground/80">{versionOptions.find((o) => o.value === value)?.label ?? 'Select version'}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        )}>
        {({ close, focusIndex }) => (
          <div className="py-1 bg-background border border-primary/20 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
            {versionOptions.map((opt, i) => (
              <button key={opt.value} data-testid={`ab-version-opt-${opt.label.replace(/\s+/g, '-').toLowerCase()}`} onClick={() => { onChange(opt.value); close(); }}
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${focusIndex === i ? 'bg-primary/15 text-foreground' : ''} ${value === opt.value ? `text-${color}-400 font-medium` : 'text-muted-foreground/90 hover:bg-secondary/30'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </Listbox>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="border border-primary/20 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {renderVersionPicker('Version A', 'blue', versionAId, setVersionAId, 'ab-version-a-trigger')}
            {renderVersionPicker('Version B', 'violet', versionBId, setVersionBId, 'ab-version-b-trigger')}
          </div>

          {versionA && versionB && (
            <div className="rounded-lg border border-primary/10 bg-secondary/10 p-3">
              <DiffViewer versionA={versionA} versionB={versionB} />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground/80">Models</label>
            <div className="flex flex-wrap gap-2">
              {ANTHROPIC_MODELS.map((m) => (
                <button key={m.id} onClick={() => toggleModel(m.id)} disabled={isLabRunning}
                  title={isLabRunning ? 'Cannot change while test is running' : undefined}
                  className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${selectedModels.has(m.id) ? 'bg-primary/15 text-primary border-primary/30' : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20'} ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {useCases.length > 0 && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground/80 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" />Focus</label>
              <Listbox itemCount={useCaseOptions.length} onSelectFocused={(idx) => { const opt = useCaseOptions[idx]; if (opt) setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); }} ariaLabel="Filter by use case"
                renderTrigger={({ isOpen, toggle }) => (
                  <button onClick={toggle} disabled={isLabRunning} title={isLabRunning ? 'Cannot change while test is running' : undefined} className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm border transition-all ${isOpen ? 'bg-primary/10 border-primary/30' : 'bg-background/30 border-primary/10 hover:border-primary/20'} ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                    <span>{useCaseOptions.find((o) => o.value === (selectedUseCaseId ?? '__all__'))?.label ?? 'All Use Cases'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}>
                {({ close, focusIndex }) => (
                  <div className="py-1 bg-background border border-primary/20 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {useCaseOptions.map((opt, i) => (
                      <button key={opt.value} onClick={() => { setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); close(); }}
                        className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${focusIndex === i ? 'bg-primary/15 text-foreground' : ''} ${(selectedUseCaseId ?? '__all__') === opt.value ? 'text-primary font-medium' : 'text-muted-foreground/90 hover:bg-secondary/30'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </Listbox>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm text-muted-foreground/70">Test Input (optional JSON)</label>
            <textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} placeholder='{"task": "Summarize the latest sales report"}' disabled={isLabRunning}
              className="w-full h-20 px-3 py-2 text-sm bg-background/50 border border-primary/20 rounded-xl text-foreground placeholder-muted-foreground/30 focus-ring resize-none font-mono disabled:opacity-50" />
          </div>

          {isLabRunning ? (
            <button data-testid="ab-cancel-btn" onClick={() => void handleCancel()} className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20">
              <Square className="w-4 h-4" />Cancel A/B Test
            </button>
          ) : (
            <Tooltip
              content={
                !versionAId ? 'Select Version A to continue'
                  : !versionBId ? 'Select Version B to continue'
                  : selectedModels.size === 0 ? 'Select at least one model'
                  : ''
              }
              placement="top"
              delay={200}
            >
              <button data-testid="ab-run-btn" onClick={() => void handleStart()} disabled={!versionAId || !versionBId || selectedModels.size === 0}
                className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100">
                <Play className="w-4 h-4" />Run A/B Test
              </button>
            </Tooltip>
          )}

          <LabProgress />
        </div>
      </div>

      <AbHistory runs={abRuns} resultsMap={abResultsMap} expandedRunId={expandedRunId} onToggleExpand={setExpandedRunId} onDelete={(id) => void deleteAbRun(id)} />
    </div>
  );
}
