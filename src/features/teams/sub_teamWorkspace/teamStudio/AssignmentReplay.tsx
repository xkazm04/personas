import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, Pause, X, RotateCcw, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaChip, stepMeta, usePersonaIndex } from './boardShared';
import type { TeamAssignmentStep } from '@/lib/bindings/TeamAssignmentStep';

const AUTO_STEP_MS = 1800;

/**
 * Step-through replay of a finished assignment — the re-targeted heir of the
 * retired canvas dry-run debugger, on REAL data: each step's requirement,
 * persona, output summary, error and timing come from the assignment's
 * recorded steps, not mock generators. One step in focus, prev/next/auto-play
 * navigation, click-to-jump dot timeline.
 */
export function AssignmentReplay({ steps, personaIndex, onExit }: {
  steps: TeamAssignmentStep[];
  personaIndex: ReturnType<typeof usePersonaIndex>;
  onExit: () => void;
}) {
  const { t, tx } = useTranslation();
  const ts = t.pipeline.team_studio;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const ordered = useMemo(() => [...steps].sort((a, b) => a.stepOrder - b.stepOrder), [steps]);
  const step = ordered[index] ?? null;

  useEffect(() => {
    if (!playing) return;
    if (index >= ordered.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((i) => Math.min(i + 1, ordered.length - 1)), AUTO_STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, index, ordered.length]);

  if (!step) return null;
  const meta = stepMeta(step.status);
  const persona = step.assignedPersonaId ? personaIndex.get(step.assignedPersonaId) : undefined;
  const durationSec = step.startedAt && step.completedAt
    ? Math.max(0, Math.round((Date.parse(toIso(step.completedAt)) - Date.parse(toIso(step.startedAt))) / 1000))
    : null;

  return (
    <div className="space-y-3" data-testid="assignment-replay">
      {/* Transport bar */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setPlaying(false); setIndex((i) => Math.max(0, i - 1)); }}
          disabled={index === 0}
          aria-label={ts.replay_prev}
          className="p-1.5 rounded-interactive border border-border bg-secondary/30 text-foreground hover:bg-secondary/50 disabled:opacity-40 transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? ts.replay_pause : ts.replay_play}
          className="p-1.5 rounded-interactive border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => { setPlaying(false); setIndex((i) => Math.min(ordered.length - 1, i + 1)); }}
          disabled={index >= ordered.length - 1}
          aria-label={ts.replay_next}
          className="p-1.5 rounded-interactive border border-border bg-secondary/30 text-foreground hover:bg-secondary/50 disabled:opacity-40 transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <span className="typo-caption text-foreground tabular-nums">
          {tx(ts.replay_step_of, { current: index + 1, total: ordered.length })}
        </span>
        {/* Click-to-jump dot timeline */}
        <div className="flex items-center gap-1 ml-2">
          {ordered.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { setPlaying(false); setIndex(i); }}
              title={s.title}
              aria-current={i === index ? 'step' : undefined}
              className={`rounded-full transition-all ${i === index ? 'w-3.5 h-2 bg-primary' : 'w-2 h-2 bg-foreground/20 hover:bg-foreground/40'}`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onExit}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-border bg-secondary/30 typo-caption text-foreground hover:bg-secondary/50 transition-colors"
        >
          <X className="w-3 h-3" /> {ts.replay_exit}
        </button>
      </div>

      {/* Focused step — all real recorded data */}
      <div className="rounded-card border border-primary/15 bg-secondary/15 px-4 py-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="typo-caption font-mono text-foreground bg-secondary/50 px-1.5 py-0.5 rounded">#{step.stepOrder + 1}</span>
          <h4 className="typo-body font-semibold text-foreground min-w-0 flex-1 truncate">{step.title}</h4>
          <PersonaChip persona={persona} />
          <span className={`typo-caption ${meta.tone}`}>{meta.label}</span>
          {step.retryCount > 0 && (
            <span className="inline-flex items-center gap-1 typo-caption text-amber-300">
              <RotateCcw className="w-3 h-3" />
              {tx(step.retryCount === 1 ? ts.replay_rework_one : ts.replay_rework_other, { count: step.retryCount })}
            </span>
          )}
          {durationSec !== null && (
            <span className="typo-caption text-foreground tabular-nums">{tx(ts.replay_duration, { seconds: durationSec })}</span>
          )}
        </div>

        {step.description && (
          <div>
            <p className="typo-label uppercase tracking-wider text-foreground mb-1">{ts.replay_requirement}</p>
            <p className="typo-body text-foreground/85 whitespace-pre-wrap">{step.description}</p>
          </div>
        )}

        <div>
          <p className="typo-label uppercase tracking-wider text-foreground mb-1">{ts.replay_output}</p>
          {step.errorMessage ? (
            <p className="flex items-start gap-1.5 typo-body text-red-300/90 whitespace-pre-wrap">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {step.errorMessage}
            </p>
          ) : step.outputSummary ? (
            <p className="typo-body text-foreground/85 whitespace-pre-wrap">{step.outputSummary}</p>
          ) : (
            <p className="typo-caption text-foreground italic">{ts.replay_no_output}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function toIso(s: string): string {
  if (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return `${s.replace(' ', 'T')}Z`;
}

export default AssignmentReplay;
