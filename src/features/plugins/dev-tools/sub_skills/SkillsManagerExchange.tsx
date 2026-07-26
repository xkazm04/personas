// PROTOTYPE VARIANT B — "Exchange".
// Metaphor: a trading floor. The two halves face each other across a narrow
// gutter that carries the exchange arrows: workspace rows push RIGHT (adopt →
// into the project), project rows push LEFT (← share into the library). Rows
// are soft cards; the project side leads with the context-tracked deck
// (coverage ring + clickable) and the standard deck below.
import { ArrowLeft, ArrowRight } from 'lucide-react';

import type { SkillsManagerVariantProps } from './SkillsManagerPage';
import { CoverageBar, MemoryBindingButton, UsageLine } from './skillsManagerBits';

function PanelTitle({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div className="flex items-baseline gap-2 px-3 py-2 bg-primary/[0.04] border-b border-primary/10 rounded-t-card">
      <span className="typo-body font-semibold text-foreground truncate">{children}</span>
      <span className="typo-label text-foreground/40 tabular-nums flex-shrink-0">{count}</span>
    </div>
  );
}

export function SkillsManagerExchange({ ws, proj, totalContexts, busy, projectName, onAdopt, onShare, onSwitchMemory, onOpenContexts }: SkillsManagerVariantProps) {
  const tracked = proj.filter((r) => r.tracked);
  const plain = proj.filter((r) => !r.tracked);

  return (
    <div className="grid grid-cols-2 gap-4 h-full min-h-0">
      {/* left — workspace */}
      <section className="min-h-0 flex flex-col rounded-card border border-primary/12 bg-secondary/[0.12]">
        <PanelTitle count={ws.length}>Workspace library</PanelTitle>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
          {ws.map(({ entry, usage, installed }) => (
            <div key={entry.name} className={`group flex items-center gap-2 px-2.5 py-2 rounded-interactive border border-transparent ${installed ? 'opacity-50' : 'hover:border-primary/20 hover:bg-primary/[0.04]'} transition-colors`}>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="typo-caption font-medium text-foreground truncate">{entry.name}</span>
                  {entry.category && <span className="typo-label text-foreground/30">{entry.category}</span>}
                </span>
                {usage && <UsageLine invokes30d={usage.invokes_30d} lastInvokedAt={usage.last_invoked_at} />}
              </span>
              {installed ? (
                <span className="typo-label text-foreground/30 flex-shrink-0">installed</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onAdopt(entry.name)}
                  disabled={busy}
                  title={`Adopt into ${projectName}`}
                  className="flex-shrink-0 p-1.5 rounded-interactive text-primary opacity-0 group-hover:opacity-100 hover:bg-primary/15 border border-primary/25 transition-all disabled:opacity-30"
                  data-testid={`skills-manager-adopt-${entry.name}`}
                >
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                </button>
              )}
            </div>
          ))}
          {ws.length === 0 && <p className="typo-caption text-foreground/45 py-8 text-center">The workspace library is empty.</p>}
        </div>
      </section>

      {/* right — project */}
      <section className="min-h-0 flex flex-col rounded-card border border-primary/12 bg-secondary/[0.12]">
        <PanelTitle count={proj.length}>{projectName || 'Project'}</PanelTitle>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
          {tracked.length > 0 && (
            <p className="px-1 pt-1 text-[10px] uppercase tracking-[0.12em] text-foreground/35">Context-tracked · 30d</p>
          )}
          {tracked.map((r) => (
            <div key={r.entry.name} className="group flex items-center gap-2 px-2.5 py-2 rounded-interactive border border-transparent hover:border-primary/20 hover:bg-primary/[0.04] transition-colors">
              <button
                type="button"
                onClick={() => onShare(r.entry.name)}
                disabled={busy || !r.shareable}
                title={r.shareable ? 'Share to the workspace library' : 'Already in the library'}
                className={`flex-shrink-0 p-1.5 rounded-interactive border transition-all disabled:opacity-20 ${r.shareable ? 'text-primary opacity-0 group-hover:opacity-100 hover:bg-primary/15 border-primary/25' : 'text-foreground/20 border-transparent'}`}
                data-testid={`skills-manager-share-${r.entry.name}`}
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
              </button>
              <button type="button" onClick={() => onOpenContexts(r.entry.name)} className="min-w-0 flex-1 text-left" data-testid={`skills-manager-proj-${r.entry.name}`}>
                <span className="flex items-center gap-2">
                  <span className="typo-caption font-medium text-foreground truncate">{r.entry.name}</span>
                  <CoverageBar row={r.coverage} total={totalContexts} />
                </span>
                {r.usage && <UsageLine invokes30d={r.usage.invokes_30d} lastInvokedAt={r.usage.last_invoked_at} />}
              </button>
              <MemoryBindingButton binding={r.entry.memory} onSwitch={(next) => onSwitchMemory(r.entry.name, next)} />
            </div>
          ))}
          {plain.length > 0 && (
            <p className="px-1 pt-2 text-[10px] uppercase tracking-[0.12em] text-foreground/35">Standard</p>
          )}
          {plain.map((r) => (
            <div key={r.entry.name} className="group flex items-center gap-2 px-2.5 py-2 rounded-interactive border border-transparent hover:border-primary/20 hover:bg-primary/[0.04] transition-colors">
              <button
                type="button"
                onClick={() => onShare(r.entry.name)}
                disabled={busy || !r.shareable}
                title={r.shareable ? 'Share to the workspace library' : 'Already in the library'}
                className={`flex-shrink-0 p-1.5 rounded-interactive border transition-all disabled:opacity-20 ${r.shareable ? 'text-primary opacity-0 group-hover:opacity-100 hover:bg-primary/15 border-primary/25' : 'text-foreground/20 border-transparent'}`}
                data-testid={`skills-manager-share-${r.entry.name}`}
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
              </button>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="typo-caption font-medium text-foreground truncate">{r.entry.name}</span>
                  {r.entry.category && <span className="typo-label text-foreground/30">{r.entry.category}</span>}
                </span>
                {r.usage && <UsageLine invokes30d={r.usage.invokes_30d} lastInvokedAt={r.usage.last_invoked_at} />}
              </span>
              <MemoryBindingButton binding={r.entry.memory} onSwitch={(next) => onSwitchMemory(r.entry.name, next)} />
            </div>
          ))}
          {proj.length === 0 && <p className="typo-caption text-foreground/45 py-8 text-center">No skills installed — adopt one from the library.</p>}
        </div>
      </section>
    </div>
  );
}
