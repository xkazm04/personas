// PROTOTYPE VARIANT C — "Composer".
// Metaphor: composing a terminal invocation. The command line is the hero — a
// large mono block that rebuilds live as you tune it. The controls sit as
// inline "chips" beneath it (run-via toggle, context chip, args), so the whole
// dialog reads as "assemble this command, then send it." Emphasises the exact
// thing that will run and where.
import { ChevronRight, Rocket, TerminalSquare, Wand2 } from 'lucide-react';

import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';

import type { ContextMode, DispatchTarget, UseSkillVariantProps } from './UseSkillDialog';
import { ArgsField, DialogFooter, SkillDescription } from './UseSkillShared';

function Pill({ on, children, onClick, testid }: { on: boolean; children: React.ReactNode; onClick: () => void; testid: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full typo-label transition-colors ${on ? 'bg-primary/15 text-primary border border-primary/30' : 'text-foreground/50 border border-primary/12 hover:text-foreground/80 hover:border-primary/25'}`}
      data-testid={testid}
    >
      {children}
    </button>
  );
}

export function UseSkillComposer(p: UseSkillVariantProps) {
  const batchCount = p.tracked && p.mode === 'all' ? p.contexts.length : 0;
  const runVia = p.target === 'cmd'
    ? <><TerminalSquare className="w-3 h-3" aria-hidden /> external CMD</>
    : <><Rocket className="w-3 h-3" aria-hidden /> Fleet</>;

  return (
    <div className="flex flex-col" data-testid="use-skill-composer">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04]">
        <Wand2 className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-title truncate">{p.skill.name}</span>
        <span className="ml-auto typo-label text-foreground/40 uppercase tracking-[0.1em] flex-shrink-0">Use</span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* the hero command line */}
        <div className="px-3 py-3 rounded-card bg-background/80 border border-primary/15 font-mono text-sm text-foreground/85 overflow-x-auto">
          <span className="text-foreground/30 select-none">❯ </span>
          <span className="text-primary">claude</span> "{p.preview}"
          {batchCount > 1 && <div className="typo-label text-foreground/35 mt-1">runs {batchCount}× — once per context</div>}
        </div>

        {/* run-via toggle */}
        <div className="flex items-center gap-2">
          <span className="typo-label text-foreground/40">run via</span>
          <Pill on={p.target === 'fleet'} onClick={() => p.setTarget('fleet')} testid="use-skill-target-fleet"><Rocket className="w-3 h-3" aria-hidden /> Fleet</Pill>
          <Pill on={p.target === 'cmd'} onClick={() => p.setTarget('cmd' as DispatchTarget)} testid="use-skill-target-cmd"><TerminalSquare className="w-3 h-3" aria-hidden /> CMD</Pill>
          <span className="typo-label text-foreground/30 ml-auto inline-flex items-center gap-1">{runVia}</span>
        </div>

        {/* context injector */}
        {p.tracked && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="typo-label text-foreground/40 inline-flex items-center gap-0.5"><ChevronRight className="w-3 h-3" aria-hidden /> context</span>
            {(['recommended', 'specific', 'all'] as ContextMode[]).map((m) => (
              <Pill key={m} on={p.mode === m} onClick={() => p.setMode(m)} testid={`use-skill-ctx-${m}`}>
                {m === 'recommended' ? 'recommended' : m === 'specific' ? 'pick' : `all (${p.contexts.length})`}
              </Pill>
            ))}
            {p.mode === 'recommended' && (
              <span className="typo-label text-foreground/50 font-mono">{p.loadingContexts ? '…' : p.recommendedName ?? '—'}</span>
            )}
            {p.mode === 'specific' && (
              <ThemedSelect
                filterable
                hideSearch
                options={p.contexts.map((c) => ({ value: c.id, label: c.name }))}
                value={p.contextId ?? ''}
                onValueChange={p.setContextId}
                placeholder="context…"
                wrapperClassName="w-44"
              />
            )}
          </div>
        )}

        <ArgsField value={p.args} onChange={p.setArgs} onSubmit={p.onConfirm} />
        <SkillDescription description={p.skill.description} />
      </div>

      <DialogFooter target={p.target} busy={p.busy} onConfirm={p.onConfirm} onClose={p.onClose} />
    </div>
  );
}
