// PROTOTYPE VARIANT B — "Composer".
// Metaphor: assembling a terminal command. Two panes — left is a scannable
// deck of skill cards (name + full description + source badge); right is a
// compose panel that gives the picked skill room: prominent description, a
// usage-hint block, an args textarea, and a terminal-styled live preview of
// the exact `claude "/command"` that will run. Deliberate over quick.
import { useState } from 'react';
import { Rocket, Terminal, Wand2 } from 'lucide-react';

import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

import { skillCommand, usageHint, type SkillRunVariantProps } from './skillRun';

export function SkillRunModalComposer({ name, state, onRun, onClose }: SkillRunVariantProps) {
  const { skills, loading, empty } = state;
  const [selected, setSelected] = useState<string | null>(null);
  const [args, setArgs] = useState('');
  const [dispatching, setDispatching] = useState(false);

  const active = skills.find((s) => s.name === selected) ?? null;
  const hint = usageHint(active?.description ?? null);
  const command = active ? skillCommand(active.name, args) : '';

  const run = async () => {
    if (!active || dispatching) return;
    setDispatching(true);
    try {
      await onRun(active.name, args);
      onClose();
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="flex flex-col max-h-[72vh]" data-testid="mm-skillrun-composer">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04]">
        <Wand2 className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-title truncate">Run a skill</span>
        <span className="ml-auto typo-caption text-foreground/50 truncate max-w-[160px]">{name}</span>
      </div>

      {loading ? (
        <div className="py-12"><LoadingSpinner label="Loading skills…" /></div>
      ) : empty ? (
        <p className="typo-caption text-foreground/45 py-12 text-center">No skills installed in this project yet.</p>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
          {/* left — skill deck */}
          <div className="min-h-0 overflow-y-auto border-r border-primary/10 p-2 space-y-1">
            {skills.map((s) => {
              const on = s.name === selected;
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => { setSelected(s.name); setArgs(''); }}
                  className={`w-full text-left px-2.5 py-2 rounded-card transition-colors ${on ? 'bg-primary/12 border border-primary/25' : 'border border-transparent hover:bg-primary/[0.05]'}`}
                  data-testid={`mm-skillrun-skill-${s.name}`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="typo-caption font-medium text-foreground truncate">/{s.name}</span>
                    {s.sourceKind && <span className="typo-label text-foreground/35 ml-auto flex-shrink-0">{s.sourceKind}</span>}
                  </span>
                  {s.description && <span className="typo-caption text-foreground/55 block leading-snug line-clamp-2 mt-0.5" style={{ fontWeight: 400 }}>{s.description}</span>}
                </button>
              );
            })}
          </div>

          {/* right — compose panel */}
          <div className="min-h-0 overflow-y-auto p-4">
            {!active ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-8">
                <Terminal className="w-6 h-6 text-foreground/25" aria-hidden />
                <p className="typo-caption text-foreground/45">Pick a skill to compose its run.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="typo-body font-semibold text-foreground">/{active.name}</div>
                  {active.description && <p className="typo-caption text-foreground/60 leading-snug mt-1" style={{ fontWeight: 400 }}>{active.description}</p>}
                </div>

                {hint && (
                  <div className="px-2.5 py-2 rounded-input bg-background/50 border border-primary/10">
                    <div className="typo-label text-foreground/45 mb-1">Usage</div>
                    <code className="typo-caption font-mono text-foreground/75 break-words">{hint}</code>
                  </div>
                )}

                <div>
                  <label className="typo-label text-foreground/45 block mb-1">Arguments (optional)</label>
                  <textarea
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    rows={2}
                    placeholder="e.g. run --l2"
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void run(); }}
                    className="w-full resize-y px-2.5 py-1.5 typo-caption font-mono rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40 placeholder:text-foreground/35"
                    data-testid="mm-skillrun-args"
                  />
                </div>

                {/* terminal-styled live preview of the exact spawn */}
                <div className="px-2.5 py-2 rounded-input bg-background/80 border border-primary/10 font-mono typo-caption text-foreground/70 overflow-x-auto">
                  <span className="text-foreground/35 select-none">❯ </span>
                  <span className="text-primary">claude</span> "{command}"
                </div>

                <button
                  type="button"
                  onClick={run}
                  disabled={dispatching}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="mm-skillrun-dispatch"
                >
                  <Rocket className="w-3.5 h-3.5" aria-hidden />
                  {dispatching ? 'Dispatching…' : 'Dispatch background run'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
