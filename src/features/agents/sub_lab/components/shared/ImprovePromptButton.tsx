import { useState } from 'react';
import { Wand2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { buildTestMetadataForDesignContext } from '../../libs/labFeedbackLoop';
import { parseDesignContext, serializeDesignContext } from '@/features/shared/components/use-cases/UseCasesList';
import { selectedModelsToConfigs } from '@/lib/models/modelCatalog';
import { useTranslation } from '@/i18n/useTranslation';

interface ImprovePromptButtonProps {
  personaId: string;
  runId: string;
  mode: 'arena' | 'ab' | 'eval' | 'matrix';
  disabled?: boolean;
}

/** Extract results array from the appropriate store results map based on mode. */
function getResultsForRun(runId: string, mode: string) {
  const store = useAgentStore.getState();
  const maps: Record<string, Record<string, unknown[]>> = {
    arena: store.arenaResultsMap,
    ab: store.abResultsMap,
    eval: store.evalResultsMap,
    matrix: store.matrixResultsMap,
  };
  return (maps[mode]?.[runId] ?? []) as Array<Record<string, unknown>>;
}

/** Extract models tested from the run object based on mode. */
function getModelsTested(runId: string, mode: string): string[] {
  const store = useAgentStore.getState();
  const runMaps: Record<string, unknown[]> = {
    arena: store.arenaRuns,
    ab: store.abRuns,
    eval: store.evalRuns,
    matrix: store.matrixRuns,
  };
  const runs = runMaps[mode] ?? [];
  const run = runs.find((r) => (r as { id: string }).id === runId) as { modelsTested?: string[] } | undefined;
  if (!run?.modelsTested) return [];
  return Array.isArray(run.modelsTested) ? run.modelsTested : [];
}

/**
 * Button that triggers a Matrix run to improve the persona's prompt
 * based on the results of the current lab run, and enriches the
 * persona's design_context with lab test metadata.
 */
export function ImprovePromptButton({ personaId, runId, mode, disabled }: ImprovePromptButtonProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const startMatrix = useAgentStore((s) => s.startMatrix);
  const updatePersona = useAgentStore((s) => s.updatePersona);
  const addToast = useToastStore((s) => s.addToast);

  const handleClick = async () => {
    setState('loading');
    setErrorMsg(null);
    try {
      // 1. Enrich design_context with lab test metadata
      const results = getResultsForRun(runId, mode);
      const modelsTested = getModelsTested(runId, mode);
      if (results.length > 0) {
        const metadata = buildTestMetadataForDesignContext(
          mode,
          results.map((r) => ({
            scenarioName: (r.scenarioName as string) ?? '',
            status: (r.status as string) ?? '',
            toolAccuracyScore: (r.toolAccuracyScore as number | null) ?? null,
            outputQualityScore: (r.outputQualityScore as number | null) ?? null,
            protocolCompliance: (r.protocolCompliance as number | null) ?? null,
            rationale: (r.rationale as string | null) ?? null,
            suggestions: (r.suggestions as string | null) ?? null,
          })),
          modelsTested,
        );

        // Read current design_context and merge in the metadata
        const persona = useAgentStore.getState().selectedPersona;
        const currentCtx = parseDesignContext(persona?.design_context);
        const enriched = serializeDesignContext({ ...currentCtx, labTestMetadata: metadata });
        await updatePersona(personaId, { design_context: enriched });
      }

      // 2. Start a Matrix run to generate an improved prompt
      const instruction = `Improve the prompt based on the ${mode} test results from run ${runId}. ` +
        `Analyze weaknesses and low-scoring scenarios, then generate an improved version ` +
        `that addresses the identified issues while preserving existing strengths.`;

      const defaultModels = selectedModelsToConfigs(new Set(['haiku', 'sonnet']));
      const newRunId = await startMatrix(personaId, instruction, defaultModels);
      if (newRunId) {
        setState('success');
        addToast('{t.agents.lab.improvement_run_started}! Check the Matrix tab for results.', 'success');
      } else {
        setState('error');
        setErrorMsg('Failed to start improvement run');
      }
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  if (state === 'success') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card text-xs font-medium bg-emerald-500/15 text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Improvement run started
      </span>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5" />
          {errorMsg || 'Failed'}
        </span>
        <button
          onClick={handleClick}
          className="px-3 py-1.5 rounded-card text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Build a preview of what will be improved
  const results = getResultsForRun(runId, mode);
  const avgScores = results.length > 0 ? (() => {
    const scoredTA = results.filter((r) => (r.toolAccuracyScore as number | null) != null);
    const scoredOQ = results.filter((r) => (r.outputQualityScore as number | null) != null);
    const scoredPC = results.filter((r) => (r.protocolCompliance as number | null) != null);
    return {
      ta: scoredTA.length > 0 ? Math.round(scoredTA.reduce((s, r) => s + (r.toolAccuracyScore as number), 0) / scoredTA.length) : 0,
      oq: scoredOQ.length > 0 ? Math.round(scoredOQ.reduce((s, r) => s + (r.outputQualityScore as number), 0) / scoredOQ.length) : 0,
      pc: scoredPC.length > 0 ? Math.round(scoredPC.reduce((s, r) => s + (r.protocolCompliance as number), 0) / scoredPC.length) : 0,
    };
  })() : null;

  const weakest = avgScores
    ? [
        { name: 'tool usage', score: avgScores.ta },
        { name: 'output quality', score: avgScores.oq },
        { name: 'protocol', score: avgScores.pc },
      ].sort((a, b) => a.score - b.score)[0]
    : null;

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleClick}
        disabled={disabled || state === 'loading'}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card text-xs font-medium bg-gradient-to-r from-violet-500/15 to-primary/15 text-primary border border-primary/15 hover:border-primary/25 hover:from-violet-500/20 hover:to-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        {state === 'loading' ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t.agents.lab.analyzing_patching}
          </>
        ) : (
          <>
            <Wand2 className="w-3.5 h-3.5" />
            {t.agents.lab.auto_improve}
          </>
        )}
      </button>
      {weakest && state === 'idle' && (
        <span className="typo-body text-foreground">
          Will focus on <strong className="text-foreground">{weakest.name}</strong> (avg {weakest.score}/100)
        </span>
      )}
    </div>
  );
}
