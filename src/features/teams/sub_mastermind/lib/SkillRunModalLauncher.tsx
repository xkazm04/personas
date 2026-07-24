// PROTOTYPE VARIANT A — "Launcher".
// Metaphor: a command launcher / Spotlight. One scrollable radio list of the
// project's skills with a filter box; the selected skill drops an inline
// "compose" strip (usage hint + optional args + live `/command` preview) and
// a Dispatch button. Keyboard-first, compact, single column.
import { useMemo, useState } from 'react';
import { CornerDownLeft, Rocket, Search, Wand2 } from 'lucide-react';

import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

import { skillCommand, usageHint, type SkillRunVariantProps } from './skillRun';

export function SkillRunModalLauncher({ name, state, onRun, onClose }: SkillRunVariantProps) {
  const { skills, loading, empty } = state;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [args, setArgs] = useState('');
  const [dispatching, setDispatching] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q));
  }, [skills, query]);

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
    <div className="flex flex-col max-h-[70vh]" data-testid="mm-skillrun-launcher">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04]">
        <Wand2 className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-title truncate">Run a skill</span>
        <span className="ml-auto typo-caption text-foreground/50 truncate max-w-[160px]">{name}</span>
      </div>

      {/* filter box */}
      <div className="px-4 pt-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/35" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter skills…"
            autoFocus
            className="w-full pl-8 pr-3 py-1.5 typo-caption rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40 placeholder:text-foreground/35"
          />
        </div>
      </div>

      {/* skill list */}
      <div className="flex-1 min-h-[120px] overflow-y-auto px-2 py-2">
        {loading ? (
          <div className="py-8"><LoadingSpinner label="Loading skills…" /></div>
        ) : empty ? (
          <p className="typo-caption text-foreground/45 py-8 text-center">No skills installed in this project yet.</p>
        ) : filtered.length === 0 ? (
          <p className="typo-caption text-foreground/45 py-8 text-center">No skill matches “{query}”.</p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((s) => {
              const on = s.name === selected;
              return (
                <li key={s.name}>
                  <button
                    type="button"
                    onClick={() => { setSelected(s.name); setArgs(''); }}
                    className={`w-full flex items-start gap-2.5 px-2.5 py-1.5 rounded-interactive text-left transition-colors ${on ? 'bg-primary/12 border border-primary/25' : 'border border-transparent hover:bg-primary/[0.05]'}`}
                    data-testid={`mm-skillrun-skill-${s.name}`}
                  >
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${on ? 'bg-primary' : 'bg-foreground/25'}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="typo-caption font-medium text-foreground">/{s.name}</span>
                        {s.sourceKind && <span className="typo-label text-foreground/35 flex-shrink-0">{s.sourceKind}</span>}
                      </span>
                      {s.description && <span className="typo-caption text-foreground/55 block leading-snug line-clamp-1" style={{ fontWeight: 400 }}>{s.description}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* compose strip — appears when a skill is picked */}
      {active && (
        <div className="px-4 py-3 border-t border-primary/10 bg-secondary/10 space-y-2">
          {hint && (
            <div className="typo-label text-foreground/45">
              Usage <code className="typo-code ml-1 text-foreground/70">{hint}</code>
            </div>
          )}
          <input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="Arguments (optional)…"
            onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
            className="w-full px-2.5 py-1.5 typo-caption font-mono rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40 placeholder:text-foreground/35"
            data-testid="mm-skillrun-args"
          />
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate typo-caption font-mono text-foreground/60 px-2 py-1 rounded-input bg-background/50 border border-primary/10">{command}</code>
            <button
              type="button"
              onClick={run}
              disabled={dispatching}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              data-testid="mm-skillrun-dispatch"
            >
              <Rocket className="w-3 h-3" aria-hidden />
              {dispatching ? 'Dispatching…' : 'Dispatch'}
              {!dispatching && <CornerDownLeft className="w-3 h-3 opacity-50" aria-hidden />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
