// PROTOTYPE VARIANT A — "Segmented".
// Metaphor: a compact settings form. Each choice is a labelled row with a
// segmented control; the context picker (a ThemedSelect) reveals only when
// "This context" is chosen. Dense, familiar, fastest to fill.
import { Wand2 } from 'lucide-react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';

import type { ContextMode, DispatchTarget, UseSkillVariantProps } from './UseSkillDialog';
import { ArgsField, DialogFooter, PreviewLine, SkillDescription } from './UseSkillShared';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="typo-label text-foreground/45 w-16 flex-shrink-0">{label}</span>
      {children}
    </div>
  );
}

export function UseSkillSegmented(p: UseSkillVariantProps) {
  const batchCount = p.tracked && p.mode === 'all' ? p.contexts.length : 0;
  return (
    <div className="flex flex-col" data-testid="use-skill-segmented">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04]">
        <Wand2 className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-title truncate">{p.skill.name}</span>
        <span className="ml-auto typo-label text-foreground/40 uppercase tracking-[0.1em] flex-shrink-0">Use</span>
      </div>

      <div className="px-4 py-3 space-y-3">
        <SkillDescription description={p.skill.description} />

        <Row label="Run via">
          <SegmentedTabs
            tabs={[{ id: 'fleet', label: 'Fleet' }, { id: 'cmd', label: 'CMD' }]}
            activeTab={p.target}
            onTabChange={(v) => p.setTarget(v as DispatchTarget)}
            variant="segment"
            size="sm"
            fullWidth={false}
            ariaLabel="Dispatch target"
          />
          <span className="typo-label text-foreground/35 truncate">
            {p.target === 'fleet' ? 'background session in Personas' : 'external terminal, outside Personas'}
          </span>
        </Row>

        {p.tracked && (
          <>
            <Row label="Context">
              <SegmentedTabs
                tabs={[{ id: 'recommended', label: 'Recommended' }, { id: 'specific', label: 'This one' }, { id: 'all', label: 'All' }]}
                activeTab={p.mode}
                onTabChange={(v) => p.setMode(v as ContextMode)}
                variant="segment"
                size="sm"
                fullWidth={false}
                ariaLabel="Context to run against"
              />
            </Row>
            {p.mode === 'recommended' && (
              <p className="typo-label text-foreground/45 pl-[4.75rem]">
                {p.loadingContexts ? 'finding the least-covered context…' : p.recommendedName ? <>→ <span className="text-foreground/70">{p.recommendedName}</span> (least covered, 30d)</> : 'no contexts scanned yet'}
              </p>
            )}
            {p.mode === 'specific' && (
              <div className="pl-[4.75rem]">
                <ThemedSelect
                  filterable
                  hideSearch
                  options={p.contexts.map((c) => ({ value: c.id, label: c.name }))}
                  value={p.contextId ?? ''}
                  onValueChange={p.setContextId}
                  placeholder="Pick a context…"
                  wrapperClassName="w-full"
                />
              </div>
            )}
            {p.mode === 'all' && (
              <p className="typo-label text-foreground/45 pl-[4.75rem]">→ one dispatch per context ({p.contexts.length})</p>
            )}
          </>
        )}

        <ArgsField value={p.args} onChange={p.setArgs} onSubmit={p.onConfirm} />
        <PreviewLine preview={p.preview} extra={batchCount > 1 ? `×${batchCount} contexts` : undefined} />
      </div>

      <DialogFooter target={p.target} busy={p.busy} onConfirm={p.onConfirm} onClose={p.onClose} />
    </div>
  );
}
