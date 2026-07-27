// PROTOTYPE VARIANT B — "Cards".
// Metaphor: a decision board. Every choice is a selectable tile with an icon +
// a one-line "what this does", so the trade-offs read at a glance. The active
// tile carries a primary ring. Spacious, deliberate — good when the operator
// is unsure which target/context they want.
import { Layers, Rocket, Target, TerminalSquare, Wand2 } from 'lucide-react';

import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';

import type { ContextMode, DispatchTarget, UseSkillVariantProps } from './UseSkillDialog';
import { ArgsField, DialogFooter, PreviewLine, SkillDescription } from './UseSkillShared';

function Tile({ on, icon: Icon, title, sub, onClick, testid }: {
  on: boolean; icon: typeof Rocket; title: string; sub: string; onClick: () => void; testid: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex-1 min-w-0 text-left px-3 py-2.5 rounded-card border transition-colors ${on ? 'border-primary/40 bg-primary/[0.08]' : 'border-primary/12 bg-secondary/[0.15] hover:border-primary/25 hover:bg-primary/[0.04]'}`}
      data-testid={testid}
    >
      <span className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${on ? 'text-primary' : 'text-foreground/50'}`} aria-hidden />
        <span className={`typo-caption font-medium truncate ${on ? 'text-foreground' : 'text-foreground/80'}`}>{title}</span>
      </span>
      <span className="typo-label text-foreground/45 block leading-snug mt-0.5">{sub}</span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="typo-label text-foreground/40 uppercase tracking-[0.1em]">{label}</span>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export function UseSkillCards(p: UseSkillVariantProps) {
  const batchCount = p.tracked && p.mode === 'all' ? p.contexts.length : 0;
  return (
    <div className="flex flex-col max-h-[76vh]" data-testid="use-skill-cards">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04]">
        <Wand2 className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-title truncate">{p.skill.name}</span>
        <span className="ml-auto typo-label text-foreground/40 uppercase tracking-[0.1em] flex-shrink-0">Use</span>
      </div>

      <div className="px-4 py-3 space-y-3 overflow-y-auto">
        <SkillDescription description={p.skill.description} />

        <Group label="Where should it run?">
          <Tile on={p.target === 'fleet'} icon={Rocket} title="Fleet" sub="Background session — you stay in Personas" onClick={() => p.setTarget('fleet')} testid="use-skill-target-fleet" />
          <Tile on={p.target === 'cmd'} icon={TerminalSquare} title="CMD" sub="External terminal, outside Personas" onClick={() => p.setTarget('cmd' as DispatchTarget)} testid="use-skill-target-cmd" />
        </Group>

        {p.tracked && (
          <Group label="Which context?">
            <Tile on={p.mode === 'recommended'} icon={Target} title="Recommended" sub={p.loadingContexts ? 'finding…' : p.recommendedName ?? 'no contexts'} onClick={() => p.setMode('recommended')} testid="use-skill-ctx-recommended" />
            <Tile on={p.mode === 'specific'} icon={Wand2} title="Specific" sub="Pick one context" onClick={() => p.setMode('specific' as ContextMode)} testid="use-skill-ctx-specific" />
            <Tile on={p.mode === 'all'} icon={Layers} title="All" sub={`One run each (${p.contexts.length})`} onClick={() => p.setMode('all')} testid="use-skill-ctx-all" />
          </Group>
        )}

        {p.tracked && p.mode === 'specific' && (
          <ThemedSelect
            filterable
            hideSearch
            options={p.contexts.map((c) => ({ value: c.id, label: c.name }))}
            value={p.contextId ?? ''}
            onValueChange={p.setContextId}
            placeholder="Pick a context…"
            wrapperClassName="w-full"
          />
        )}

        <ArgsField value={p.args} onChange={p.setArgs} onSubmit={p.onConfirm} />
        <PreviewLine preview={p.preview} extra={batchCount > 1 ? `×${batchCount} contexts` : undefined} />
      </div>

      <DialogFooter target={p.target} busy={p.busy} onConfirm={p.onConfirm} onClose={p.onClose} />
    </div>
  );
}
