/**
 * PracticeStep: stage 3 of the project pipeline. Picks the project's
 * development practice preset (Lifecycle v2): Solo (default) or Team. Two
 * large radio cards, each naming the preset, a one-line summary and its steps
 * as a row of chips; Team's added or stricter steps are highlighted. The steps
 * themselves are not edited here: Athena changes a practice after creation.
 *
 * The step lists mirror `preset_doc` in src-tauri/src/lifecycle/presets.rs;
 * change both together.
 */
import { useRef, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { LifecyclePreset } from '@/lib/bindings/LifecyclePreset';

import { presetLabel, stepLabel } from '../../sub_lifecycle/journey/journeyLabels';

interface PresetPreview {
  preset: LifecyclePreset;
  steps: string[];
  /** Steps Team adds or makes stricter than Solo. */
  marked: ReadonlySet<string>;
}

const PREVIEWS: PresetPreview[] = [
  {
    preset: 'solo',
    steps: ['frame', 'recall', 'isolate', 'sync', 'gate', 'tests', 'docs', 'commit', 'land', 'record'],
    marked: new Set(),
  },
  {
    preset: 'team',
    steps: ['frame', 'recall', 'isolate', 'link', 'sync', 'gate', 'tests', 'docs', 'commit', 'land', 'record'],
    marked: new Set(['isolate', 'link', 'gate', 'tests', 'docs', 'commit', 'land', 'record']),
  },
];

interface PracticeStepProps {
  preset: LifecyclePreset;
  onChange: (preset: LifecyclePreset) => void;
}

export function PracticeStep({ preset, onChange }: PracticeStepProps) {
  const { t, tx } = useTranslation();
  const dp = t.plugins.dev_projects;
  const dl = t.plugins.dev_lifecycle;
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  const select = (index: number) => {
    const next = PREVIEWS[(index + PREVIEWS.length) % PREVIEWS.length]!;
    onChange(next.preset);
    refs.current[PREVIEWS.indexOf(next)]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(index + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(index - 1); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); select(index); }
  };

  return (
    <div className="space-y-4">
      <p className="typo-body text-foreground leading-relaxed">{dp.practice_intro}</p>

      <div role="radiogroup" aria-label={dp.pipeline_step_practice} className="grid gap-3" data-testid="practice-picker">
        {PREVIEWS.map((p, index) => {
          const checked = p.preset === preset;
          return (
            <div
              key={p.preset}
              ref={(el) => { refs.current[index] = el; }}
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(p.preset)}
              onKeyDown={(e) => onKeyDown(e, index)}
              data-testid={`practice-${p.preset}`}
              className={`cursor-pointer rounded-card border p-4 transition-colors focus-ring ${
                checked ? 'bg-primary/8 border-primary/40' : 'bg-secondary/30 border-primary/10 hover:bg-secondary/50'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    checked ? 'border-primary bg-primary text-background' : 'border-foreground/40'
                  }`}
                  aria-hidden
                >
                  {checked && <Check className="w-3 h-3" />}
                </span>
                <span className="typo-title text-foreground">{presetLabel(dl, p.preset)}</span>
                {p.preset === 'solo' && (
                  <span className="typo-caption text-primary">{dp.practice_default}</span>
                )}
                <span className="ml-auto typo-caption text-foreground">
                  {tx(dp.practice_step_count, { count: p.steps.length })}
                </span>
              </div>
              <p className="typo-caption text-foreground mb-3">
                {p.preset === 'team' ? dp.practice_team_summary : dp.practice_solo_summary}
              </p>
              <ol className="flex flex-wrap gap-1.5">
                {p.steps.map((id) => (
                  <li
                    key={id}
                    data-marked={p.marked.has(id) || undefined}
                    className={`typo-caption px-2 py-0.5 rounded-interactive border ${
                      p.marked.has(id)
                        ? 'border-status-warning/50 bg-status-warning/10 text-foreground'
                        : 'border-primary/15 text-foreground'
                    }`}
                  >
                    {stepLabel(dl, id)}
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>

      <p className="typo-caption text-foreground">{dp.practice_team_marks}</p>
    </div>
  );
}
