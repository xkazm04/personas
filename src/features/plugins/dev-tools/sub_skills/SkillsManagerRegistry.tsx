// PROTOTYPE VARIANT A — "Registry".
// Metaphor: an editorial ledger. Two symmetric dense columns under uppercase
// headers — Workspace library (left) · the active project (right). Rows are
// thin, divider-separated, data-forward: name, usage right-aligned, quiet
// row-end actions (Adopt / Share) that appear on hover. The project side
// groups CONTEXT-TRACKED skills (coverage bar rows, clickable → per-context
// modal) above STANDARD skills (progress-less rows).
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';

import type { SkillsManagerVariantProps } from './SkillsManagerPage';
import { CoverageBar, MemoryBindingButton, UsageLine } from './skillsManagerBits';

function ColumnHeader({ label, meta }: { label: string; meta: string }) {
  return (
    <div className="flex items-baseline gap-2 pb-2 border-b border-foreground/20">
      <span className="text-[10.5px] uppercase tracking-[0.14em] text-foreground/50 font-semibold">{label}</span>
      <span className="ml-auto typo-label text-foreground/35 tabular-nums">{meta}</span>
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="pt-3 pb-1 text-[10px] uppercase tracking-[0.12em] text-foreground/35">{children}</div>;
}

export function SkillsManagerRegistry({ ws, proj, totalContexts, busy, projectName, onAdopt, onShare, onSwitchMemory, onOpenContexts }: SkillsManagerVariantProps) {
  const tracked = proj.filter((r) => r.tracked);
  const plain = proj.filter((r) => !r.tracked);

  return (
    <div className="grid grid-cols-2 gap-6 h-full min-h-0">
      {/* left — workspace library */}
      <section className="min-h-0 overflow-y-auto pr-1">
        <ColumnHeader label="Workspace library" meta={`${ws.length} skills`} />
        <ul>
          {ws.map(({ entry, usage, installed }) => (
            <li key={entry.name} className="group flex items-center gap-2 py-2 border-b border-foreground/[0.08]">
              <span className={`typo-caption font-medium truncate ${installed ? 'text-foreground/40' : 'text-foreground'}`}>{entry.name}</span>
              {entry.category && <span className="typo-label text-foreground/30 flex-shrink-0">{entry.category}</span>}
              <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                {usage && <UsageLine invokes30d={usage.invokes_30d} lastInvokedAt={usage.last_invoked_at} />}
                {installed ? (
                  <span className="typo-label text-foreground/30">installed</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAdopt(entry.name)}
                    disabled={busy}
                    title={`Adopt into ${projectName} — Claude customizes it for the repo`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive typo-label text-primary opacity-0 group-hover:opacity-100 hover:bg-primary/10 border border-primary/25 transition-all disabled:opacity-30"
                    data-testid={`skills-manager-adopt-${entry.name}`}
                  >
                    <ArrowDownToLine className="w-3 h-3" aria-hidden />
                    Adopt
                  </button>
                )}
              </span>
            </li>
          ))}
          {ws.length === 0 && <li className="typo-caption text-foreground/45 py-8 text-center">The workspace library is empty — share a project skill to seed it.</li>}
        </ul>
      </section>

      {/* right — active project */}
      <section className="min-h-0 overflow-y-auto pr-1">
        <ColumnHeader label={projectName || 'Project'} meta={`${proj.length} skills`} />
        {tracked.length > 0 && (
          <>
            <GroupLabel>Context-tracked · coverage 30d</GroupLabel>
            <ul>
              {tracked.map((r) => (
                <li key={r.entry.name}>
                  <button
                    type="button"
                    onClick={() => onOpenContexts(r.entry.name)}
                    className="group w-full flex items-center gap-2 py-2 border-b border-foreground/[0.08] text-left hover:bg-primary/[0.04] rounded-interactive px-1 -mx-1 transition-colors"
                    data-testid={`skills-manager-proj-${r.entry.name}`}
                  >
                    <MemoryBindingButton binding={r.entry.memory} onSwitch={(next) => onSwitchMemory(r.entry.name, next)} />
                    <span className="typo-caption font-medium text-foreground truncate">{r.entry.name}</span>
                    <CoverageBar row={r.coverage} total={totalContexts} />
                    <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                      {r.usage && <UsageLine invokes30d={r.usage.invokes_30d} lastInvokedAt={r.usage.last_invoked_at} />}
                      {r.shareable && <ShareButton name={r.entry.name} busy={busy} onShare={onShare} />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <GroupLabel>Standard</GroupLabel>
        <ul>
          {plain.map((r) => (
            <li key={r.entry.name} className="group flex items-center gap-2 py-2 border-b border-foreground/[0.08] px-1 -mx-1">
              <MemoryBindingButton binding={r.entry.memory} onSwitch={(next) => onSwitchMemory(r.entry.name, next)} />
              <span className="typo-caption font-medium text-foreground truncate">{r.entry.name}</span>
              {r.entry.category && <span className="typo-label text-foreground/30 flex-shrink-0">{r.entry.category}</span>}
              <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                {r.usage && <UsageLine invokes30d={r.usage.invokes_30d} lastInvokedAt={r.usage.last_invoked_at} />}
                {r.shareable && <ShareButton name={r.entry.name} busy={busy} onShare={onShare} />}
              </span>
            </li>
          ))}
          {proj.length === 0 && <li className="typo-caption text-foreground/45 py-8 text-center">No skills installed — adopt one from the library.</li>}
        </ul>
      </section>
    </div>
  );
}

function ShareButton({ name, busy, onShare }: { name: string; busy: boolean; onShare: (n: string) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onShare(name); }}
      disabled={busy}
      title="Share to the workspace library — Claude generalizes it"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive typo-label text-primary opacity-0 group-hover:opacity-100 hover:bg-primary/10 border border-primary/25 transition-all disabled:opacity-30"
      data-testid={`skills-manager-share-${name}`}
    >
      <ArrowUpFromLine className="w-3 h-3" aria-hidden />
      Share
    </button>
  );
}
