// Crew Foundry — the Factory L2 Overview surface that forges a
// project-scoped persona crew from the project's own telemetry.
//
// Idle: shows the compiled deficits + the "Forge this project's crew" button.
// Composing / failed / bound states are explicit and honest. Once the project
// has a bound team, the panel becomes the crew-fitness strip: per-persona
// assignment success rate (instrumented now, even while sparse) with the
// AthenaComposedBadge marking foundry provenance.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Hammer, Loader2, RefreshCw, Users } from 'lucide-react';

import { getCrossProjectMetadata } from '@/api/devTools/devTools';
import {
  getCrewFitness, getProjectPulseSnapshots, synthesizeProjectCrew,
  type CrewFitnessReport, type ProjectPulseSnapshot,
} from '@/api/devTools/crewFoundry';
import { AthenaComposedBadge } from '@/features/shared/components/feedback/AthenaComposedBadge';
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';
import { silentCatch } from '@/lib/silentCatch';

import { INK } from '../passport/passportInk';
import { derivePassportFromMetadata } from '../passport/passportDerive';
import type { FactoryL2Data } from '../l2/factoryL2Data';
import {
  compileCrewBrief, derivePassportGaps, directiveLines,
  type CompiledCrewBrief, type CrewBriefInput, type PassportGap,
} from './briefCompiler';

type ForgeState =
  | { kind: 'idle' }
  | { kind: 'composing' }
  | { kind: 'failed'; error: string };

/** Merge recent pulse days into the compiler's single-pulse input: latest
 *  narrative, tensions unioned across days (dedup, order preserved). */
function mergePulse(snapshots: ProjectPulseSnapshot[]): CrewBriefInput['pulse'] {
  const latest = snapshots[0];
  if (!latest) return null;
  const tensions = [...new Set(snapshots.flatMap((s) => s.tensions))];
  const directions = [...new Set(snapshots.flatMap((s) => s.directions))];
  return { narrativeMd: latest.narrativeMd, tensions, directions };
}

export function CrewFoundryPanel({ data }: { data: FactoryL2Data }) {
  const project = data.project;
  const [forge, setForge] = useState<ForgeState>({ kind: 'idle' });
  const [pulse, setPulse] = useState<ProjectPulseSnapshot[]>([]);
  const [gaps, setGaps] = useState<PassportGap[]>([]);
  // Locally-forged team id — shows the crew immediately, before reloadMap
  // refetches the project row.
  const [forgedTeamId, setForgedTeamId] = useState<string | null>(null);
  const [fitness, setFitness] = useState<CrewFitnessReport | null>(null);
  const [fitnessLoading, setFitnessLoading] = useState(false);

  const teamId = forgedTeamId ?? project?.team_id ?? null;

  // Brief inputs (pulse + passport gaps) — fetched once per project.
  useEffect(() => {
    if (!project) return;
    let alive = true;
    void getProjectPulseSnapshots(project.id, 3)
      .then((rows) => { if (alive) setPulse(rows); })
      .catch(silentCatch('crewFoundry:pulse'));
    void getCrossProjectMetadata()
      .then((map) => {
        if (!alive || !map) return;
        const meta = map.projects.find((p) => p.project_id === project.id);
        if (!meta) return;
        setGaps(derivePassportGaps(derivePassportFromMetadata(meta, project)));
      })
      .catch(silentCatch('crewFoundry:passport'));
    return () => { alive = false; };
  }, [project]);

  // Fitness — refetched whenever the bound team changes.
  useEffect(() => {
    if (!teamId) { setFitness(null); return; }
    let alive = true;
    setFitnessLoading(true);
    void getCrewFitness(teamId)
      .then((r) => { if (alive) setFitness(r); })
      .catch(silentCatch('crewFoundry:fitness'))
      .finally(() => { if (alive) setFitnessLoading(false); });
    return () => { alive = false; };
  }, [teamId]);

  const compiled: CompiledCrewBrief | null = useMemo(() => {
    if (!project) return null;
    return compileCrewBrief({
      projectName: project.name,
      summary: project.description ?? null,
      pulse: mergePulse(pulse),
      contexts: data.contexts.map((c) => ({
        name: c.name,
        errorCount: data.monitoringWired ? data.runtime.errorsByContext.get(c.id) ?? 0 : null,
        goalCount: data.goalCountByContext.get(c.id) ?? 0,
      })),
      passportGaps: gaps,
      offTrackKpis: data.kpis
        .filter((k) => k.status === 'active' && kpiTrack(k) === 'off-track')
        .map((k) => ({
          name: k.name,
          contextName: k.context_id
            ? data.contexts.find((c) => c.id === k.context_id)?.name ?? null
            : null,
          current: k.current_value,
          target: k.target_value,
          unit: k.unit,
        })),
    });
  }, [project, pulse, gaps, data.contexts, data.kpis, data.goalCountByContext, data.runtime.errorsByContext, data.monitoringWired]);

  const doForge = useCallback(() => {
    if (!project || !compiled) return;
    setForge({ kind: 'composing' });
    void synthesizeProjectCrew(project.id, compiled.brief, directiveLines(compiled), `${project.name} Crew`)
      .then((result) => {
        setForge({ kind: 'idle' });
        setForgedTeamId(result.team_id);
        data.reloadMap(); // refetch the project row (team_id is now wired)
      })
      .catch((e: unknown) => {
        setForge({ kind: 'failed', error: e instanceof Error ? e.message : String(e) });
      });
  }, [project, compiled, data]);

  if (!project || data.loading) return null;

  const frame = { background: 'rgba(148,163,184,.03)', border: `1px solid ${INK.violet}2e` };

  // -- bound crew: the fitness strip -------------------------------------------
  if (teamId) {
    const forged = fitness?.forgedFromProjectId === project.id;
    const hasSignal = (fitness?.personas ?? []).some((p) => p.stepsTotal > 0);
    return (
      <div className="rounded-card px-3 py-2 mb-3" style={frame} data-testid="crew-foundry-panel">
        <span className="flex items-center gap-2 flex-wrap min-w-0">
          <Users className="w-3.5 h-3.5 shrink-0" style={{ color: INK.violet }} aria-hidden />
          <span className="typo-caption font-medium text-foreground/90 truncate">
            {fitness ? `Crew: ${fitness.teamName}` : 'Crew'}
          </span>
          {forged && (
            <AthenaComposedBadge
              variant="composed"
              label="Forged by Athena"
              title={`Forged from this project's pulse, incident heat, passport gaps and off-track KPIs${fitness?.forgedAt ? ` on ${fitness.forgedAt.slice(0, 10)}` : ''}`}
            />
          )}
          {fitnessLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-foreground/40" aria-hidden />}
        </span>
        {fitness && fitness.personas.length === 0 && (
          <p className="typo-caption text-foreground/45 mt-1">Team has no members yet.</p>
        )}
        {fitness && fitness.personas.length > 0 && (
          <span className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-1.5">
            {fitness.personas.map((p) => (
              <span key={p.personaId} className="inline-flex items-center gap-1.5 typo-caption min-w-0" data-testid={`crew-fitness-${p.personaId}`}>
                <span className="text-foreground/80 truncate">{p.personaName}</span>
                <span className="text-foreground/35">{p.role}</span>
                {p.stepsTotal > 0 ? (
                  <span
                    className="tabular-nums font-medium"
                    style={{ color: (p.successRate ?? 0) >= 0.7 ? INK.emerald : (p.successRate ?? 0) >= 0.4 ? INK.amber : INK.red }}
                    title={`${p.stepsDone} done · ${p.stepsFailed} failed`}
                  >
                    {Math.round((p.successRate ?? 0) * 100)}% of {p.stepsTotal}
                  </span>
                ) : (
                  <span className="text-foreground/30 italic">no runs yet</span>
                )}
              </span>
            ))}
          </span>
        )}
        {fitness && fitness.personas.length > 0 && !hasSignal && (
          <p className="typo-caption text-foreground/40 mt-1">
            No assignment signal yet — success rates appear once this crew works a goal.
          </p>
        )}
      </div>
    );
  }

  // -- no crew yet: the forge surface ------------------------------------------
  const composing = forge.kind === 'composing';
  const noContexts = data.contexts.length === 0;
  return (
    <div className="rounded-card px-3 py-2 mb-3" style={frame} data-testid="crew-foundry-panel">
      <span className="flex items-center gap-2 flex-wrap">
        <Hammer className="w-3.5 h-3.5 shrink-0" style={{ color: INK.violet }} aria-hidden />
        <span className="typo-caption font-medium text-foreground/90">Crew Foundry</span>
        <span className="typo-caption text-foreground/45 min-w-0">
          {noContexts
            ? 'Scan contexts first — I forge the crew from the project map.'
            : compiled && compiled.deficits.length > 0
              ? `I found ${compiled.deficits.length} deficit${compiled.deficits.length === 1 ? '' : 's'} to staff against: ${compiled.deficits.map((d) => d.split(':')[0]).join(' · ')}`
              : 'Telemetry is thin — I will forge a minimal implementer crew for the open goals.'}
        </span>
        <button
          type="button"
          onClick={doForge}
          disabled={composing || noContexts || !compiled}
          className="ml-auto inline-flex items-center gap-1.5 rounded-card px-2.5 py-1 typo-caption font-medium transition-colors focus-ring hover:bg-foreground/[0.05] disabled:opacity-50 shrink-0"
          style={{ color: INK.violet, border: `1px solid ${INK.violet}55` }}
          data-testid="crew-foundry-forge"
        >
          {composing
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
            : <Hammer className="w-3.5 h-3.5" aria-hidden />}
          {composing ? 'Forging crew…' : "Forge this project's crew"}
        </button>
      </span>
      {composing && (
        <p className="typo-caption text-foreground/45 mt-1">
          I&apos;m composing a crew from this project&apos;s pulse, incident heat, passport gaps and off-track KPIs — about a minute.
        </p>
      )}
      {forge.kind === 'failed' && (
        <p className="typo-caption mt-1 flex items-center gap-2" style={{ color: INK.red }} data-testid="crew-foundry-error">
          Forge failed: {forge.error}
          <button
            type="button"
            onClick={doForge}
            className="inline-flex items-center gap-1 rounded-interactive px-1.5 py-0.5 transition-colors hover:bg-foreground/[0.08] focus-ring"
            style={{ color: INK.violet }}
          >
            <RefreshCw className="w-3 h-3" aria-hidden />
            Retry
          </button>
        </p>
      )}
    </div>
  );
}
