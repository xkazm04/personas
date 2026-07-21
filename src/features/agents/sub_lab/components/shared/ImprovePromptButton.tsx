import { useState } from 'react';
import { Wand2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { buildTestMetadataForDesignContext } from '../../libs/labFeedbackLoop';
import { parseDesignContext, serializeDesignContext } from '@/features/agents/sub_lab/use-cases/UseCasesList';
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

/** Average the three sub-scores across results; null when nothing was scored. */
function avgScores(results: Array<Record<string, unknown>>) {
  if (results.length === 0) return null;
  const avg = (key: string) => {
    const scored = results.filter((r) => (r[key] as number | null) != null);
    return scored.length > 0
      ? Math.round(scored.reduce((s, r) => s + (r[key] as number), 0) / scored.length)
      : 0;
  };
  return { ta: avg('toolAccuracyScore'), oq: avg('outputQualityScore'), pc: avg('protocolCompliance') };
}

/**
 * "Auto-Improve" action for a completed lab run. Runs the REAL improvement
 * engine and creates a grounded new version:
 *  1. Enriches the persona's design_context with lab test metadata (the durable
 *     feedback loop from testing back into building).
 *  2. Calls `lab_improve_prompt` (via `improvePromptVersion`), which grounds an
 *     LLM rewrite server-side in the full current prompt + per-scenario judge
 *     rationale/suggestions + this run's user ratings, and persists it as a new
 *     `experimental` version that appears in the Versions table ready to measure.
 *
 * Previously this only seeded the Athena chat composer with ~4 scalars and asked
 * the user "what should I focus on?", dropping the judge's own diagnosis — the
 * `lab_improve_prompt` binding had zero callers (UAT 2026-07-20). The judge's
 * rationale/suggestions now reach the thing that writes the next version.
 */
export function ImprovePromptButton({ personaId, runId, mode, disabled }: ImprovePromptButtonProps) {
  const { t, tx } = useTranslation();
  const lab = t.agents.lab;
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [newVersion, setNewVersion] = useState<number | null>(null);

  const handleClick = async () => {
    setState('loading');
    setErrorMsg(null);
    try {
      const results = getResultsForRun(runId, mode);
      const modelsTested = getModelsTested(runId, mode);

      // 1. Enrich design_context with lab test metadata (the feedback loop).
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
        const persona = useAgentStore.getState().selectedPersona;
        const currentCtx = parseDesignContext(persona?.design_context);
        const enriched = serializeDesignContext({ ...currentCtx, labTestMetadata: metadata });
        await useAgentStore.getState().updatePersona(personaId, { design_context: enriched });
      }

      // 2. Run the real improvement engine — grounded in judge rationale +
      //    suggestions + user ratings server-side — and persist a new version.
      const version = await useAgentStore.getState().improvePromptVersion(personaId, runId, mode);
      if (!version) {
        // reportError already surfaced the cause via the store.
        setState('error');
        setErrorMsg(lab.improve_failed);
        return;
      }
      setNewVersion(version.version_number);
      setState('success');
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : lab.improve_failed);
    }
  };

  if (state === 'success') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption font-medium bg-emerald-500/15 text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5" />
        {newVersion != null ? `${lab.improve_ready_title} · v${newVersion}` : lab.improve_ready_title}
      </span>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 typo-caption text-red-400">
          <AlertCircle className="w-3.5 h-3.5" />
          {errorMsg || lab.improve_failed}
        </span>
        <button
          onClick={handleClick}
          className="px-3 py-1.5 rounded-card typo-caption font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          {t.common.retry}
        </button>
      </div>
    );
  }

  // Idle: show a preview of the weakest area the brief will target.
  const scores = avgScores(getResultsForRun(runId, mode));
  const weakest = scores
    ? [
        { label: lab.vr_metric_tool, v: scores.ta },
        { label: lab.vr_metric_quality, v: scores.oq },
        { label: lab.vr_metric_protocol, v: scores.pc },
      ].reduce((a, b) => (b.v < a.v ? b : a))
    : null;

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleClick}
        disabled={disabled || state === 'loading'}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption font-medium bg-gradient-to-r from-violet-500/15 to-primary/15 text-primary border border-primary/15 hover:border-primary/25 hover:from-violet-500/20 hover:to-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        {state === 'loading' ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {lab.analyzing_patching}
          </>
        ) : (
          <>
            <Wand2 className="w-3.5 h-3.5" />
            {lab.auto_improve}
          </>
        )}
      </button>
      {weakest && state === 'idle' && (
        <span className="typo-body text-foreground">
          {tx(lab.improve_focus, { metric: weakest.label, score: weakest.v })}
        </span>
      )}
    </div>
  );
}
