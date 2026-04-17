import { useState, useCallback, useMemo } from 'react';
import { FlaskConical, Play, Square, ArrowRight } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import type { UseCaseItem } from '@/features/shared/components/use-cases/UseCasesList';
import type { TestFixture } from '@/lib/types/frontendTypes';
import { resolveEffectiveModel } from '../../libs/useCaseDetailHelpers';
import { mutateSingleUseCase } from '@/hooks/design/core/useDesignContextMutator';
import { UseCaseFixtureDropdown } from '../detail/UseCaseFixtureDropdown';
import { useTranslation } from '@/i18n/useTranslation';

interface UseCaseTestRunnerProps {
  useCaseId: string;
  useCase: UseCaseItem;
  defaultModelProfile: string | null;
}

export function UseCaseTestRunner({ useCaseId, useCase, defaultModelProfile }: UseCaseTestRunnerProps) {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const isTestRunning = useAgentStore((s) => s.isTestRunning);
  const testRunProgress = useAgentStore((s) => s.testRunProgress);
  const startTest = useAgentStore((s) => s.startTest);
  const cancelTest = useAgentStore((s) => s.cancelTest);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);

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

  const { t } = useTranslation();
  const uc = t.agents.use_cases;
  const canCancel = !!testRunProgress?.runId;
  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;

  return (
    <div className="space-y-2">
      <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
        <FlaskConical className="w-3.5 h-3.5" />
        {uc.test}
      </h5>

      <div className="bg-secondary/30 border border-primary/10 rounded-modal p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground/70 min-w-0">
            {uc.run_with} <span className="text-foreground/80 font-medium">{resolved.label}</span>
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
          <div className="px-2.5 py-2 rounded-card bg-amber-500/5 border border-amber-500/15 text-xs">
            <span className="text-amber-400/70 font-medium">{uc.fixture_inputs}</span>
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
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-modal font-medium text-sm bg-red-500/80 hover:bg-red-500 text-foreground transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title={!canCancel ? uc.waiting_for_test : uc.cancel_test}
            >
              <Square className="w-3.5 h-3.5" /> {t.common.cancel}
            </button>

            {/* Progress */}
            {testRunProgress && (
                <div
                  className="animate-fade-slide-in overflow-hidden"
                >
                  <div className="flex items-center gap-2 text-sm text-foreground/70">
                    <LoadingSpinner size="sm" className="text-primary" />
                    <span className="capitalize">
                      {testRunProgress.phase === 'generating'
                        ? uc.generating
                        : testRunProgress.phase === 'executing'
                          ? `${uc.testing} ${testRunProgress.scenarioName ?? ''}`
                          : testRunProgress.phase}
                    </span>
                  </div>
                  {testRunProgress.total && (
                    <div className="w-full h-1 rounded-full bg-secondary/50 overflow-hidden mt-2">
                      <div
                        className="animate-fade-in h-full rounded-full bg-primary/60" style={{ width: `${((testRunProgress.current ?? 0) / testRunProgress.total) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
          </>
        ) : (
          <button
            onClick={handleRun}
            disabled={!hasPrompt || !resolved.config}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-modal font-medium text-sm bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-elevation-3 shadow-primary/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="w-3.5 h-3.5" /> {uc.test_use_case}
          </button>
        )}

        <button
          onClick={() => setEditorTab('lab')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground/60 hover:text-primary/80 transition-colors"
        >
          {uc.view_full_test_history} <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
