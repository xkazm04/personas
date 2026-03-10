import { useState, useEffect, useMemo } from 'react';
import {
  Play, Square, ChevronDown, Filter,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { DiffViewer } from '../../shared/DiffViewer';
import { LabProgress } from '../../shared/LabProgress';
import { parseDesignContext, type UseCaseItem } from '@/features/shared/components/use-cases/UseCasesList';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import type { ModelTestConfig } from '@/api/agents/tests';
import { ANTHROPIC_MODELS, ALL_MODELS } from './abModels';
import { AbHistory } from './AbHistory';

export function AbPanel() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const promptVersions = usePersonaStore((s) => s.promptVersions);
  const abRuns = usePersonaStore((s) => s.abRuns);
  const abResultsMap = usePersonaStore((s) => s.abResultsMap);
  const isLabRunning = usePersonaStore((s) => s.isLabRunning);
  const fetchVersions = usePersonaStore((s) => s.fetchVersions);
  const fetchAbRuns = usePersonaStore((s) => s.fetchAbRuns);
  const startAb = usePersonaStore((s) => s.startAb);
  const cancelAb = usePersonaStore((s) => s.cancelAb);
  const fetchAbResults = usePersonaStore((s) => s.fetchAbResults);
  const deleteAbRun = usePersonaStore((s) => s.deleteAbRun);

  const [versionAId, setVersionAId] = useState<string | null>(null);
  const [versionBId, setVersionBId] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set(['haiku']));
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | null>(null);
  const [testInput, setTestInput] = useState('');
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedPersona?.id) {
      fetchVersions(selectedPersona.id);
      fetchAbRuns(selectedPersona.id);
    }
  }, [selectedPersona?.id, fetchVersions, fetchAbRuns]);

  useEffect(() => {
    if (expandedRunId) fetchAbResults(expandedRunId);
  }, [expandedRunId, fetchAbResults]);

  const versionA = useMemo(() => promptVersions.find((v) => v.id === versionAId) ?? null, [promptVersions, versionAId]);
  const versionB = useMemo(() => promptVersions.find((v) => v.id === versionBId) ?? null, [promptVersions, versionBId]);

  const useCases: UseCaseItem[] = useMemo(() => {
    const ctx = parseDesignContext(selectedPersona?.design_context);
    return ctx.useCases ?? [];
  }, [selectedPersona?.design_context]);

  const useCaseOptions = useMemo(() => [
    { value: '__all__', label: 'All Use Cases' },
    ...useCases.map((uc) => ({ value: uc.id, label: uc.title })),
  ], [useCases]);

  const versionOptions = useMemo(() =>
    promptVersions.map((v) => ({ value: v.id, label: `v${v.version_number} — ${v.tag}` })),
  [promptVersions]);

  const handleStart = async () => {
    if (!selectedPersona || !versionAId || !versionBId || selectedModels.size === 0) return;
    const models: ModelTestConfig[] = [...selectedModels]
      .map((id) => {
        const opt = ALL_MODELS.find((m) => m.id === id);
        if (!opt) return null;
        return { id: opt.id, provider: opt.provider, model: opt.model, base_url: opt.base_url };
      })
      .filter(Boolean) as ModelTestConfig[];

    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startAb(selectedPersona.id, versionAId, versionBId, models, useCaseFilter, testInput.trim() || undefined);
    if (runId) setActiveRunId(runId);
  };

  const handleCancel = async () => {
    if (activeRunId) {
      await cancelAb(activeRunId);
      setActiveRunId(null);
    }
  };

  const renderVersionPicker = (
    label: string,
    color: string,
    value: string | null,
    setValue: (v: string) => void,
  ) => (
    <div className="space-y-1">
      <label className={`text-sm font-medium text-${color}-400`}>{label}</label>
      <Listbox
        itemCount={versionOptions.length}
        onSelectFocused={(idx) => {
          const opt = versionOptions[idx];
          if (opt) setValue(opt.value);
        }}
        ariaLabel={`Select ${label.toLowerCase()}`}
        renderTrigger={({ isOpen, toggle }) => (
          <button
            onClick={toggle}
            disabled={isLabRunning}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm border transition-all ${
              isOpen ? `bg-${color}-500/10 border-${color}-500/30` : 'bg-background/30 border-primary/10 hover:border-primary/20'
            } ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className="text-foreground/80">{versionOptions.find((o) => o.value === value)?.label ?? 'Select version'}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
      >
        {({ close, focusIndex }) => (
          <div className="py-1 bg-background border border-primary/15 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
            {versionOptions.map((opt, i) => (
              <button
                key={opt.value}
                onClick={() => { setValue(opt.value); close(); }}
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                  focusIndex === i ? 'bg-primary/15 text-foreground' : ''
                } ${value === opt.value ? `text-${color}-400 font-medium` : 'text-muted-foreground/90 hover:bg-secondary/30'}`}
              >
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
      <div className="border border-primary/15 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
        <div className="p-4 space-y-4">
          {/* Version pickers */}
          <div className="grid grid-cols-2 gap-4">
            {renderVersionPicker('Version A', 'blue', versionAId, setVersionAId)}
            {renderVersionPicker('Version B', 'violet', versionBId, setVersionBId)}
          </div>

          {/* Inline diff preview */}
          {versionA && versionB && (
            <div className="rounded-lg border border-primary/10 bg-secondary/10 p-3">
              <DiffViewer versionA={versionA} versionB={versionB} />
            </div>
          )}

          {/* Model selector */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground/80">Models</label>
            <div className="flex flex-wrap gap-2">
              {ANTHROPIC_MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setSelectedModels((prev) => {
                      const next = new Set(prev);
                      if (next.has(m.id)) next.delete(m.id);
                      else next.add(m.id);
                      return next;
                    });
                  }}
                  disabled={isLabRunning}
                  className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
                    selectedModels.has(m.id)
                      ? 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20'
                  } ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Use case filter */}
          {useCases.length > 0 && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground/80 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5" />
                Focus
              </label>
              <Listbox
                itemCount={useCaseOptions.length}
                onSelectFocused={(idx) => {
                  const opt = useCaseOptions[idx];
                  if (opt) setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value);
                }}
                ariaLabel="Filter by use case"
                renderTrigger={({ isOpen, toggle }) => (
                  <button
                    onClick={toggle}
                    disabled={isLabRunning}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm border transition-all ${
                      isOpen ? 'bg-primary/10 border-primary/30' : 'bg-background/30 border-primary/10 hover:border-primary/20'
                    } ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span>{useCaseOptions.find((o) => o.value === (selectedUseCaseId ?? '__all__'))?.label ?? 'All Use Cases'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}
              >
                {({ close, focusIndex }) => (
                  <div className="py-1 bg-background border border-primary/15 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {useCaseOptions.map((opt, i) => (
                      <button
                        key={opt.value}
                        onClick={() => { setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); close(); }}
                        className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                          focusIndex === i ? 'bg-primary/15 text-foreground' : ''
                        } ${(selectedUseCaseId ?? '__all__') === opt.value ? 'text-primary font-medium' : 'text-muted-foreground/90 hover:bg-secondary/30'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </Listbox>
            </div>
          )}

          {/* Test input */}
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground/70">Test Input (optional JSON)</label>
            <textarea
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder='{"task": "Summarize the latest sales report"}'
              disabled={isLabRunning}
              className="w-full h-20 px-3 py-2 text-sm bg-background/50 border border-primary/15 rounded-xl text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono disabled:opacity-50"
            />
          </div>

          {/* Run / Cancel */}
          {isLabRunning ? (
            <button
              onClick={() => void handleCancel()}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20"
            >
              <Square className="w-4 h-4" />
              Cancel A/B Test
            </button>
          ) : (
            <button
              onClick={() => void handleStart()}
              disabled={!versionAId || !versionBId || selectedModels.size === 0}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              <Play className="w-4 h-4" />
              Run A/B Test
            </button>
          )}

          <LabProgress />
        </div>
      </div>

      {/* History */}
      <AbHistory
        abRuns={abRuns}
        expandedRunId={expandedRunId}
        setExpandedRunId={setExpandedRunId}
        abResultsMap={abResultsMap}
        deleteAbRun={deleteAbRun}
      />
    </div>
  );
}
