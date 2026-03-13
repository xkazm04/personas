import { useState, useEffect, useMemo } from 'react';
import {
  Square, ChevronDown,
  Filter, Wand2, AlertCircle,
} from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { Button } from '@/features/shared/components/buttons';
import { LabProgress } from '../../shared/LabProgress';
import { parseDesignContext, type UseCaseItem } from '@/features/shared/components/use-cases/UseCasesList';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import type { ModelTestConfig } from '@/api/agents/tests';
import { ANTHROPIC_MODELS, ALL_MODELS } from './matrixModels';
import { MatrixHistory } from './MatrixHistory';

export function MatrixPanel() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const isLabRunning = useAgentStore((s) => s.isLabRunning);
  const fetchMatrixRuns = useAgentStore((s) => s.fetchMatrixRuns);
  const startMatrix = useAgentStore((s) => s.startMatrix);
  const cancelMatrix = useAgentStore((s) => s.cancelMatrix);

  const [instruction, setInstruction] = useState('');
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set(['haiku', 'sonnet']));
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedPersona?.id) fetchMatrixRuns(selectedPersona.id);
  }, [selectedPersona?.id, fetchMatrixRuns]);

  const useCases: UseCaseItem[] = useMemo(() => {
    const ctx = parseDesignContext(selectedPersona?.design_context);
    return ctx.useCases ?? [];
  }, [selectedPersona?.design_context]);

  const useCaseOptions = useMemo(() => [
    { value: '__all__', label: 'All Use Cases' },
    ...useCases.map((uc) => ({ value: uc.id, label: uc.title })),
  ], [useCases]);

  const handleStart = async () => {
    if (!selectedPersona || !instruction.trim() || selectedModels.size === 0) return;
    const models: ModelTestConfig[] = [...selectedModels]
      .map((id) => {
        const opt = ALL_MODELS.find((m) => m.id === id);
        if (!opt) return null;
        return { id: opt.id, provider: opt.provider, model: opt.model, base_url: opt.base_url };
      })
      .filter(Boolean) as ModelTestConfig[];

    const useCaseFilter = selectedUseCaseId && selectedUseCaseId !== '__all__' ? selectedUseCaseId : undefined;
    const runId = await startMatrix(selectedPersona.id, instruction.trim(), models, useCaseFilter);
    if (runId) {
      setActiveRunId(runId);
      setInstruction('');
    }
  };

  const handleCancel = async () => {
    if (activeRunId) {
      await cancelMatrix(activeRunId);
      setActiveRunId(null);
    }
  };

  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;

  return (
    <div className="space-y-6">
      <div className="border border-primary/20 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
        <div className="p-4 space-y-4">
          {!hasPrompt && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-400/90">This persona has no prompt configured. Add a prompt first.</p>
            </div>
          )}

          {/* Instruction textarea */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/80">Describe your desired changes</label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. Make the greeting more formal and add multi-language support for German and French"
              disabled={isLabRunning}
              className="w-full h-28 px-3 py-2 text-sm bg-background/50 border border-primary/20 rounded-xl text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none disabled:opacity-50"
            />
            <p className="text-sm text-muted-foreground/50">
              Claude will generate a draft persona based on your instructions, then test both current and draft versions side by side.
            </p>
          </div>

          {/* Model selector */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground/80">Models</label>
            <div className="flex flex-wrap gap-2">
              {ANTHROPIC_MODELS.map((m) => (
                <Button
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
                  variant="ghost"
                  size="sm"
                  className={`px-3 py-1.5 rounded-xl border ${
                    selectedModels.has(m.id)
                      ? 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20'
                  }`}
                >
                  {m.label}
                </Button>
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
                  <Button
                    onClick={toggle}
                    disabled={isLabRunning}
                    variant="ghost"
                    size="md"
                    block
                    iconRight={<ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl border ${
                      isOpen ? 'bg-primary/10 border-primary/30' : 'bg-background/30 border-primary/10 hover:border-primary/20'
                    }`}
                  >
                    <span>{useCaseOptions.find((o) => o.value === (selectedUseCaseId ?? '__all__'))?.label ?? 'All Use Cases'}</span>
                  </Button>
                )}
              >
                {({ close, focusIndex }) => (
                  <div className="py-1 bg-background border border-primary/20 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {useCaseOptions.map((opt, i) => (
                      <Button
                        key={opt.value}
                        onClick={() => { setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); close(); }}
                        variant="ghost"
                        size="sm"
                        block
                        className={`w-full text-left px-3 py-1.5 rounded-none ${
                          focusIndex === i ? 'bg-primary/15 text-foreground' : ''
                        } ${(selectedUseCaseId ?? '__all__') === opt.value ? 'text-primary font-medium' : 'text-muted-foreground/90 hover:bg-secondary/30'}`}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                )}
              </Listbox>
            </div>
          )}

          {/* Run / Cancel */}
          {isLabRunning ? (
            <Button
              onClick={() => void handleCancel()}
              variant="danger"
              size="lg"
              block
              icon={<Square className="w-4 h-4" />}
              className="shadow-lg shadow-red-500/20"
            >
              Cancel Matrix Test
            </Button>
          ) : (
            <Button
              onClick={() => void handleStart()}
              disabled={!instruction.trim() || selectedModels.size === 0 || !hasPrompt}
              variant="primary"
              size="lg"
              block
              icon={<Wand2 className="w-4 h-4" />}
              className="bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-500/90 hover:to-purple-500/90 shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 hover:scale-[1.01] active:scale-[0.99]"
            >
              Generate & Test Draft
            </Button>
          )}

          <LabProgress />
        </div>
      </div>

      {/* History */}
      <MatrixHistory />
    </div>
  );
}
