import { useState, useCallback, useMemo } from 'react';
import { FlaskConical, Play, Square, Loader2, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import type { UseCaseItem } from '@/features/shared/components/use-cases/UseCasesList';
import type { TestFixture } from '@/lib/types/frontendTypes';
import { resolveEffectiveModel } from '../../libs/useCaseDetailHelpers';
import { mutateSingleUseCase } from '@/hooks/design/core/useDesignContextMutator';
import { UseCaseFixtureDropdown } from '../detail/UseCaseFixtureDropdown';

interface UseCaseTestRunnerProps {
  useCaseId: string;
  useCase: UseCaseItem;
  defaultModelProfile: string | null;
}

export function UseCaseTestRunner({ useCaseId, useCase, defaultModelProfile }: UseCaseTestRunnerProps) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const isTestRunning = usePersonaStore((s) => s.isTestRunning);
  const testRunProgress = usePersonaStore((s) => s.testRunProgress);
  const startTest = usePersonaStore((s) => s.startTest);
  const cancelTest = usePersonaStore((s) => s.cancelTest);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);

  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);

  const fixtures = useMemo(() => useCase.test_fixtures ?? [], [useCase.test_fixtures]);
  const selectedFixture = useMemo(
    () => fixtures.find((f) => f.id === selectedFixtureId) ?? null,
    [fixtures, selectedFixtureId],
  );

  const resolved = useMemo(
    () => resolveEffectiveModel(useCase.model_override, defaultModelProfile),
    [useCase.model_override, defaultModelProfile],
  );

  const handleRun = useCallback(async () => {
    if (!selectedPersona || !resolved.config) return;
    // Pass fixture inputs as the suite context if a fixture is selected
    const inputs = selectedFixture?.inputs;
    const fixtureInputs = inputs && Object.keys(inputs).length > 0 ? inputs : undefined;
    await startTest(selectedPersona.id, [resolved.config], useCaseId, undefined, fixtureInputs);
  }, [selectedPersona, resolved.config, useCaseId, startTest, selectedFixture]);

  const handleCancel = useCallback(async () => {
    if (testRunProgress?.runId) {
      await cancelTest(testRunProgress.runId);
    }
  }, [testRunProgress, cancelTest]);

  const handleSaveFixture = useCallback(
    (name: string, description: string, inputs: Record<string, unknown>) => {
      if (!selectedPersona) return;
      const now = new Date().toISOString();
      const fixture: TestFixture = {
        id: `fixture-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        description: description || undefined,
        inputs: Object.keys(inputs).length > 0 ? inputs : (useCase.sample_input ?? {}),
        created_at: now,
        updated_at: now,
      };
      mutateSingleUseCase(selectedPersona.id, useCaseId, (uc) => ({
        ...uc,
        test_fixtures: [...(uc.test_fixtures ?? []), fixture],
      }));
      setSelectedFixtureId(fixture.id);
    },
    [selectedPersona, useCaseId, useCase.sample_input],
  );

  const handleDeleteFixture = useCallback(
    (fixtureId: string) => {
      if (!selectedPersona) return;
      mutateSingleUseCase(selectedPersona.id, useCaseId, (uc) => ({
        ...uc,
        test_fixtures: (uc.test_fixtures ?? []).filter((f) => f.id !== fixtureId),
      }));
    },
    [selectedPersona, useCaseId],
  );

  const handleUpdateFixture = useCallback(
    (fixtureId: string, inputs: Record<string, unknown>) => {
      if (!selectedPersona) return;
      mutateSingleUseCase(selectedPersona.id, useCaseId, (uc) => ({
        ...uc,
        test_fixtures: (uc.test_fixtures ?? []).map((f) =>
          f.id === fixtureId ? { ...f, inputs, updated_at: new Date().toISOString() } : f,
        ),
      }));
    },
    [selectedPersona, useCaseId],
  );

  const canCancel = !!testRunProgress?.runId;
  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;

  return (
    <div className="space-y-2">
      <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
        <FlaskConical className="w-3.5 h-3.5" />
        Test
      </h5>

      <div className="bg-secondary/30 border border-primary/10 rounded-xl p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground/70 min-w-0">
            Run with <span className="text-foreground/80 font-medium">{resolved.label}</span>
          </p>
          <UseCaseFixtureDropdown
            fixtures={fixtures}
            selectedFixtureId={selectedFixtureId}
            onSelect={setSelectedFixtureId}
            onSave={handleSaveFixture}
            onDelete={handleDeleteFixture}
            onUpdate={handleUpdateFixture}
            currentInputs={selectedFixture?.inputs ?? useCase.sample_input ?? undefined}
          />
        </div>

        {/* Show active fixture inputs preview */}
        {selectedFixture && Object.keys(selectedFixture.inputs).length > 0 && (
          <div className="px-2.5 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15 text-xs">
            <span className="text-amber-400/70 font-medium">Fixture inputs:</span>
            <pre className="mt-1 text-muted-foreground/70 whitespace-pre-wrap break-all max-h-20 overflow-y-auto">
              {JSON.stringify(selectedFixture.inputs, null, 2)}
            </pre>
          </div>
        )}

        {isTestRunning ? (
          <>
            <button
              onClick={handleCancel}
              disabled={!canCancel}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-medium text-sm bg-red-500/80 hover:bg-red-500 text-foreground transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title={!canCancel ? 'Waiting for test to start...' : 'Cancel test'}
            >
              <Square className="w-3.5 h-3.5" /> Cancel
            </button>

            {/* Progress */}
            <AnimatePresence>
              {testRunProgress && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-2 text-sm text-foreground/70">
                    <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                    <span className="capitalize">
                      {testRunProgress.phase === 'generating'
                        ? 'Generating scenarios...'
                        : testRunProgress.phase === 'executing'
                          ? `Testing ${testRunProgress.scenarioName ?? ''}...`
                          : testRunProgress.phase}
                    </span>
                  </div>
                  {testRunProgress.total && (
                    <div className="w-full h-1 rounded-full bg-secondary/50 overflow-hidden mt-2">
                      <motion.div
                        className="h-full rounded-full bg-primary/60"
                        animate={{ width: `${((testRunProgress.current ?? 0) / testRunProgress.total) * 100}%` }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                      />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <button
            onClick={handleRun}
            disabled={!hasPrompt || !resolved.config}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-medium text-sm bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="w-3.5 h-3.5" /> Test Use Case
          </button>
        )}

        <button
          onClick={() => setEditorTab('lab')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground/60 hover:text-primary/80 transition-colors"
        >
          View full test history <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
