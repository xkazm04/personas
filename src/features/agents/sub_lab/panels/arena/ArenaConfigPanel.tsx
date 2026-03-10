import { Play, Square, ChevronDown, AlertCircle, Filter } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { LabProgress } from '../../shared/LabProgress';
import { ANTHROPIC_MODELS, OLLAMA_MODELS } from './arenaModels';
import type { UseCaseItem } from '@/features/shared/components/use-cases/UseCasesList';

interface ArenaConfigPanelProps {
  hasPrompt: boolean;
  hasTools: boolean;
  isLabRunning: boolean;
  selectedModels: Set<string>;
  toggleModel: (id: string) => void;
  useCases: UseCaseItem[];
  useCaseOptions: Array<{ value: string; label: string }>;
  selectedUseCaseId: string | null;
  setSelectedUseCaseId: (id: string | null) => void;
  selectedUseCase: UseCaseItem | null;
  onStart: () => void;
  onCancel: () => void;
}

export function ArenaConfigPanel({
  hasPrompt,
  hasTools,
  isLabRunning,
  selectedModels,
  toggleModel,
  useCases,
  useCaseOptions,
  selectedUseCaseId,
  setSelectedUseCaseId,
  selectedUseCase,
  onStart,
  onCancel,
}: ArenaConfigPanelProps) {
  return (
    <div className="border border-primary/15 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
      <div className="p-4 space-y-4">
        {/* Warnings */}
        {(!hasPrompt || !hasTools) && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-400/90">
              {!hasPrompt && <p>This persona has no prompt configured. Add a prompt first.</p>}
              {!hasTools && <p>This persona has no tools assigned. Add tools for richer testing.</p>}
            </div>
          </div>
        )}

        {/* Use case filter */}
        {useCases.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground/80 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5" />
              Focus on Use Case
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
                    isOpen
                      ? 'bg-primary/10 border-primary/30 text-foreground/90'
                      : 'bg-background/30 border-primary/10 text-muted-foreground/90 hover:border-primary/20'
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
                      onClick={() => {
                        setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value);
                        close();
                      }}
                      className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                        focusIndex === i ? 'bg-primary/15 text-foreground' : ''
                      } ${
                        (selectedUseCaseId ?? '__all__') === opt.value
                          ? 'text-primary font-medium'
                          : 'text-muted-foreground/90 hover:bg-secondary/30'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </Listbox>
          </div>
        )}

        {/* Model selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground/80">Select Models to Compare</label>
          <div className="space-y-2">
            <div className="space-y-1">
              <span className="text-sm text-muted-foreground/80 uppercase tracking-wider">Anthropic</span>
              <div className="flex flex-wrap gap-2">
                {ANTHROPIC_MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => toggleModel(m.id)}
                    disabled={isLabRunning}
                    className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
                      selectedModels.has(m.id)
                        ? 'bg-primary/15 text-primary border-primary/30'
                        : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20 hover:text-foreground/95'
                    } ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {OLLAMA_MODELS.length > 0 && (
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground/80 uppercase tracking-wider">Ollama Cloud</span>
                <div className="flex flex-wrap gap-2">
                  {OLLAMA_MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => toggleModel(m.id)}
                      disabled={isLabRunning}
                      className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
                        selectedModels.has(m.id)
                          ? 'bg-primary/15 text-primary border-primary/30'
                          : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20 hover:text-foreground/95'
                      } ${isLabRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Run / Cancel */}
        {isLabRunning ? (
          <button
            onClick={onCancel}
            className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20"
          >
            <Square className="w-4 h-4" />
            Cancel Test
          </button>
        ) : (
          <button
            onClick={onStart}
            disabled={selectedModels.size === 0 || !hasPrompt}
            className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            <Play className="w-4 h-4" />
            Run Arena ({selectedModels.size} model{selectedModels.size !== 1 ? 's' : ''}{selectedUseCase ? ` — ${selectedUseCase.title}` : ''})
          </button>
        )}

        <LabProgress />
      </div>
    </div>
  );
}
