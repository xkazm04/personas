// Skills Manager board — the FUSED design (prototype round 2): Exchange's
// panel containers wrap Registry's space-efficient rows.
//   · panels: rounded-card border, title band with count, footer 30d note
//   · rows: thin divider-separated, hover-revealed Adopt/Share actions
//   · grouping: visual divider rows with the group name (left: category;
//     right: context-tracked vs standard) — never stated per row
//   · sortable column headers (Skill / Usage) per panel, sorting WITHIN groups
//     so the functional grouping survives a usage sort
//   · installed = icon (CheckCircle2), usage terse (`12×`), "/30d" lives once
//     in the footer
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpFromLine, CheckCircle2 } from 'lucide-react';

import type { SkillsManagerVariantProps, ProjRow, WsRow } from './SkillsManagerPage';
import { CoverageBar, MemoryBindingButton, UsageLine } from './skillsManagerBits';

type SortKey = 'name' | 'usage';
type SortDir = 'asc' | 'desc';

function useSort(): { key: SortKey; dir: SortDir; toggle: (k: SortKey) => void } {
  const [key, setKey] = useState<SortKey>('name');
  const [dir, setDir] = useState<SortDir>('asc');
  const toggle = (k: SortKey) => {
    if (k === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setKey(k); setDir(k === 'usage' ? 'desc' : 'asc'); }
  };
  return { key, dir, toggle };
}

function sortRows<T>(rows: T[], key: SortKey, dir: SortDir, name: (r: T) => string, usage: (r: T) => number): T[] {
  const sorted = [...rows].sort((a, b) =>
    key === 'name' ? name(a).localeCompare(name(b)) : usage(a) - usage(b) || name(a).localeCompare(name(b)),
  );
  return dir === 'desc' ? sorted.reverse() : sorted;
}

function Panel({ title, count, header, footer, children }: {
  title: string; count: number; header: React.ReactNode; footer: string; children: React.ReactNode;
}) {
  return (
    <section className="min-h-0 flex flex-col rounded-card border border-primary/12 bg-secondary/[0.12]">
      <div className="flex items-baseline gap-2 px-3 py-2 bg-primary/[0.04] border-b border-primary/10 rounded-t-card flex-shrink-0">
        <span className="typo-body font-semibold text-foreground truncate">{title}</span>
        <span className="typo-label text-foreground/40 tabular-nums flex-shrink-0">{count}</span>
      </div>
      {header}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-1">{children}</div>
      <div className="px-3 py-1.5 border-t border-primary/10 flex-shrink-0">
        <span className="typo-label text-foreground/35">{footer}</span>
      </div>
    </section>
  );
}

function SortHeaders({ sort }: { sort: ReturnType<typeof useSort> }) {
  const Head = ({ k, label, alignEnd }: { k: SortKey; label: string; alignEnd?: boolean }) => {
    const on = sort.key === k;
    const Icon = sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => sort.toggle(k)}
        className={`inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.12em] transition-colors focus-ring rounded-interactive ${on ? 'text-foreground/80 font-semibold' : 'text-foreground/40 hover:text-foreground/70'} ${alignEnd ? 'ml-auto' : ''}`}
        data-testid={`skills-manager-sort-${k}`}
      >
        {label}
        {on && <Icon className="w-3 h-3" aria-hidden />}
      </button>
    );
  };
  return (
    <div className="flex items-center px-3 py-1.5 border-b border-primary/10 flex-shrink-0">
      <Head k="name" label="Skill" />
      <Head k="usage" label="Usage" alignEnd />
    </div>
  );
}

/** Group divider — the ONLY place a group name appears. */
function GroupDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-3 pb-1">
      <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/40 flex-shrink-0">{children}</span>
      <span className="flex-1 h-px bg-foreground/10" />
    </div>
  );
}

export function SkillsManagerBoard({ ws, proj, totalContexts, busy, projectName, onAdopt, onShare, onSwitchMemory, onOpenContexts }: SkillsManagerVariantProps) {
  const wsSort = useSort();
  const projSort = useSort();

  // Left — category groups (name-asc), sorted within each group.
  const wsGroups = useMemo(() => {
    const byCat = new Map<string, WsRow[]>();
    for (const r of ws) {
      const cat = r.entry.category ?? 'Other';
      const list = byCat.get(cat);
      if (list) list.push(r); else byCat.set(cat, [r]);
    }
    return [...byCat.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, rows]) => [cat, sortRows(rows, wsSort.key, wsSort.dir, (r) => r.entry.name, (r) => r.usage?.invokes_30d ?? 0)] as const);
  }, [ws, wsSort.key, wsSort.dir]);

  // Right — tracked vs standard, sorted within each.
  const tracked = useMemo(
    () => sortRows(proj.filter((r) => r.tracked), projSort.key, projSort.dir, (r) => r.entry.name, (r) => r.usage?.invokes_30d ?? 0),
    [proj, projSort.key, projSort.dir],
  );
  const plain = useMemo(
    () => sortRows(proj.filter((r) => !r.tracked), projSort.key, projSort.dir, (r) => r.entry.name, (r) => r.usage?.invokes_30d ?? 0),
    [proj, projSort.key, projSort.dir],
  );

  return (
    <div className="grid grid-cols-2 gap-4 h-full min-h-0">
      <Panel title="Workspace library" count={ws.length} header={<SortHeaders sort={wsSort} />} footer="Usage: last 30 days">
        {wsGroups.map(([cat, rows]) => (
          <div key={cat}>
            <GroupDivider>{cat}</GroupDivider>
            <ul>
              {rows.map(({ entry, usage, installed }) => (
                <li key={entry.name} className="group flex items-center gap-2 py-2 border-b border-foreground/[0.08] last:border-b-0">
                  <span className={`typo-caption font-medium truncate ${installed ? 'text-foreground/45' : 'text-foreground'}`}>{entry.name}</span>
                  {installed && (
                    <span title={`Installed in ${projectName}`} className="flex-shrink-0 inline-flex">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70" aria-label={`Installed in ${projectName}`} />
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                    {usage && <UsageLine invokes30d={usage.invokes_30d} lastInvokedAt={usage.last_invoked_at} />}
                    {!installed && (
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
            </ul>
          </div>
        ))}
        {ws.length === 0 && <p className="typo-caption text-foreground/45 py-8 text-center">The workspace library is empty — share a project skill to seed it.</p>}
      </Panel>

      <Panel title={projectName || 'Project'} count={proj.length} header={<SortHeaders sort={projSort} />} footer="Usage · coverage: last 30 days">
        {tracked.length > 0 && (
          <>
            <GroupDivider>Context-tracked</GroupDivider>
            <ul>
              {tracked.map((r) => (
                <li key={r.entry.name}>
                  <button
                    type="button"
                    onClick={() => onOpenContexts(r.entry.name)}
                    className="group w-full flex items-center gap-2 py-2 border-b border-foreground/[0.08] last:border-b-0 text-left hover:bg-primary/[0.04] rounded-interactive px-1 -mx-1 transition-colors"
                    data-testid={`skills-manager-proj-${r.entry.name}`}
                  >
                    <MemoryBindingButton binding={r.entry.memory} onSwitch={(next) => onSwitchMemory(r.entry.name, next)} />
                    <span className="typo-caption font-medium text-foreground truncate">{r.entry.name}</span>
                    <CoverageBar row={r.coverage} total={totalContexts} />
                    <RowTail row={r} busy={busy} onShare={onShare} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {plain.length > 0 && (
          <>
            <GroupDivider>Standard</GroupDivider>
            <ul>
              {plain.map((r) => (
                <li key={r.entry.name} className="group flex items-center gap-2 py-2 border-b border-foreground/[0.08] last:border-b-0 px-1 -mx-1">
                  <MemoryBindingButton binding={r.entry.memory} onSwitch={(next) => onSwitchMemory(r.entry.name, next)} />
                  <span className="typo-caption font-medium text-foreground truncate">{r.entry.name}</span>
                  <RowTail row={r} busy={busy} onShare={onShare} />
                </li>
              ))}
            </ul>
          </>
        )}
        {proj.length === 0 && <p className="typo-caption text-foreground/45 py-8 text-center">No skills installed — adopt one from the library.</p>}
      </Panel>
    </div>
  );
}

function RowTail({ row, busy, onShare }: { row: ProjRow; busy: boolean; onShare: (n: string) => void }) {
  return (
    <span className="ml-auto flex items-center gap-2 flex-shrink-0">
      {row.usage && <UsageLine invokes30d={row.usage.invokes_30d} lastInvokedAt={row.usage.last_invoked_at} />}
      {row.shareable && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onShare(row.entry.name); }}
          disabled={busy}
          title="Share to the workspace library — Claude generalizes it"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive typo-label text-primary opacity-0 group-hover:opacity-100 hover:bg-primary/10 border border-primary/25 transition-all disabled:opacity-30"
          data-testid={`skills-manager-share-${row.entry.name}`}
        >
          <ArrowUpFromLine className="w-3 h-3" aria-hidden />
          Share
        </button>
      )}
    </span>
  );
}
