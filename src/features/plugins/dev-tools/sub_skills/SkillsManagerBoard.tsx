// Skills Manager board — columnar layout (Name · Usage · Last used · Action)
// inside Exchange-style panels. Row actions are ICON-ONLY (Adopt ↓ / Share ↑ /
// Use ▶) and each opens a confirmation modal showing the skill's description
// before the LLM task or Fleet dispatch fires. Grouping renders as divider rows
// (left: category; right: context-tracked vs standard); sorting (Skill / Usage)
// applies WITHIN groups so the grouping survives a usage sort.
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpFromLine, CheckCircle2, Play } from 'lucide-react';

import type { SkillEntry } from '@/api/devTools/devTools';
import { useTranslation } from '@/i18n/useTranslation';

import type { SkillsManagerVariantProps, ProjRow, WsRow } from './SkillsManagerPage';
import { CoverageBar, LastUsed, MemoryBindingButton, UsageCount } from './skillsManagerBits';
import { SkillActionConfirm } from './SkillActionConfirm';
import { UseSkillDialog } from './UseSkillDialog';

type Pending = { kind: 'adopt' | 'share'; skill: SkillEntry } | { kind: 'use'; skill: SkillEntry; tracked: boolean };

type SortKey = 'name' | 'usage';
type SortDir = 'asc' | 'desc';

/** Shared 4-column grid template — header and every row align to it. */
const COLS = 'grid grid-cols-[minmax(0,1fr)_2.5rem_4.5rem_auto] items-center gap-3';

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

/** Column-header row (matches COLS): sortable Name/Usage, static Last used/Action. */
function HeaderRow({ sort }: { sort: ReturnType<typeof useSort> }) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const SortHead = ({ k, label }: { k: SortKey; label: string }) => {
    const on = sort.key === k;
    const Icon = sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => sort.toggle(k)}
        className={`inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.12em] transition-colors focus-ring rounded-interactive ${on ? 'text-foreground/80 font-semibold' : 'text-foreground/40 hover:text-foreground/70'}`}
        data-testid={`skills-manager-sort-${k}`}
      >
        {label}{on && <Icon className="w-3 h-3" aria-hidden />}
      </button>
    );
  };
  const H = ({ children }: { children: React.ReactNode }) => (
    <span className="text-[10.5px] uppercase tracking-[0.12em] text-foreground/40 text-right">{children}</span>
  );
  return (
    <div className={`${COLS} px-3 py-1.5 border-b border-primary/10 flex-shrink-0`}>
      <SortHead k="name" label={d.skills_sort_skill} />
      <span className="text-right"><SortHead k="usage" label={d.skills_sort_usage} /></span>
      <H>{d.skills_col_lastused}</H>
      <H>{d.skills_col_action}</H>
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

/** Icon-only action button. */
function ActionIcon({ icon: Icon, title, onClick, disabled, testid }: {
  icon: typeof Play; title: string; onClick: () => void; disabled?: boolean; testid: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="p-1 rounded-interactive text-primary hover:bg-primary/10 border border-primary/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
      data-testid={testid}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
    </button>
  );
}

export function SkillsManagerBoard({ ws, proj, totalContexts, busy, projectName, projectId, onAdopt, onShare, onUse, onSwitchMemory, onOpenContexts }: SkillsManagerVariantProps) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const wsSort = useSort();
  const projSort = useSort();
  const [pending, setPending] = useState<Pending | null>(null);

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

  const tracked = useMemo(
    () => sortRows(proj.filter((r) => r.tracked), projSort.key, projSort.dir, (r) => r.entry.name, (r) => r.usage?.invokes_30d ?? 0),
    [proj, projSort.key, projSort.dir],
  );
  const plain = useMemo(
    () => sortRows(proj.filter((r) => !r.tracked), projSort.key, projSort.dir, (r) => r.entry.name, (r) => r.usage?.invokes_30d ?? 0),
    [proj, projSort.key, projSort.dir],
  );

  const confirmAdoptShare = () => {
    if (!pending || pending.kind === 'use') return;
    if (pending.kind === 'adopt') onAdopt(pending.skill.name);
    else onShare(pending.skill.name);
    setPending(null);
  };

  const renderProjRow = (r: ProjRow) => (
    <li key={r.entry.name} className={`${COLS} py-2 border-b border-foreground/[0.08] last:border-b-0`}>
      {/* Name cell: memory icon + name (opens contexts when tracked) + coverage */}
      <span className="flex items-center gap-2 min-w-0">
        <MemoryBindingButton binding={r.entry.memory} onSwitch={(next) => onSwitchMemory(r.entry.name, next)} />
        {r.tracked ? (
          <button
            type="button"
            onClick={() => onOpenContexts(r.entry.name)}
            className="min-w-0 flex items-center gap-2 text-left hover:text-primary transition-colors"
            data-testid={`skills-manager-proj-${r.entry.name}`}
          >
            <span className="typo-caption font-medium text-foreground truncate">{r.entry.name}</span>
            <CoverageBar row={r.coverage} total={totalContexts} />
          </button>
        ) : (
          <span className="typo-caption font-medium text-foreground truncate" data-testid={`skills-manager-proj-${r.entry.name}`}>{r.entry.name}</span>
        )}
      </span>
      <UsageCount usage={r.usage} />
      <LastUsed usage={r.usage} />
      <span className="flex items-center gap-1.5 justify-end">
        <ActionIcon icon={Play} title={tx(d.skills_use_hint, { name: projectName })} onClick={() => setPending({ kind: 'use', skill: r.entry, tracked: r.tracked })} testid={`skills-manager-use-${r.entry.name}`} />
        {r.shareable && (
          <ActionIcon icon={ArrowUpFromLine} title={d.skills_share_hint} onClick={() => setPending({ kind: 'share', skill: r.entry })} disabled={busy} testid={`skills-manager-share-${r.entry.name}`} />
        )}
      </span>
    </li>
  );

  return (
    <div className="grid grid-cols-2 gap-4 h-full min-h-0">
      <Panel title={d.skills_workspace_library} count={ws.length} header={<HeaderRow sort={wsSort} />} footer={d.skills_footer_usage}>
        {wsGroups.map(([cat, rows]) => (
          <div key={cat}>
            <GroupDivider>{cat}</GroupDivider>
            <ul>
              {rows.map(({ entry, usage, installed }) => (
                <li key={entry.name} className={`${COLS} py-2 border-b border-foreground/[0.08] last:border-b-0`}>
                  <span className={`typo-caption font-medium truncate ${installed ? 'text-foreground/45' : 'text-foreground'}`}>{entry.name}</span>
                  <UsageCount usage={usage} />
                  <LastUsed usage={usage} />
                  <span className="flex items-center justify-end">
                    {installed ? (
                      <span title={tx(d.skills_installed_in, { name: projectName })} className="inline-flex p-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70" aria-label={tx(d.skills_installed_in, { name: projectName })} />
                      </span>
                    ) : (
                      <ActionIcon icon={ArrowDownToLine} title={tx(d.skills_adopt_hint, { name: projectName })} onClick={() => setPending({ kind: 'adopt', skill: entry })} disabled={busy} testid={`skills-manager-adopt-${entry.name}`} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {ws.length === 0 && <p className="typo-caption text-foreground/45 py-8 text-center">{d.skills_ws_empty}</p>}
      </Panel>

      <Panel title={projectName || d.skills_project_fallback} count={proj.length} header={<HeaderRow sort={projSort} />} footer={d.skills_footer_usage_coverage}>
        {tracked.length > 0 && (
          <>
            <GroupDivider>{d.skills_group_tracked}</GroupDivider>
            <ul>{tracked.map(renderProjRow)}</ul>
          </>
        )}
        {plain.length > 0 && (
          <>
            <GroupDivider>{d.skills_group_standard}</GroupDivider>
            <ul>{plain.map(renderProjRow)}</ul>
          </>
        )}
        {proj.length === 0 && <p className="typo-caption text-foreground/45 py-8 text-center">{d.skills_proj_empty}</p>}
      </Panel>

      {pending && pending.kind !== 'use' && (
        <SkillActionConfirm
          kind={pending.kind}
          skill={pending.skill}
          projectName={projectName}
          busy={busy}
          onConfirm={confirmAdoptShare}
          onClose={() => setPending(null)}
        />
      )}
      {pending && pending.kind === 'use' && projectId && (
        <UseSkillDialog
          skill={pending.skill}
          projectId={projectId}
          tracked={pending.tracked}
          busy={busy}
          onConfirm={(choice) => { onUse(pending.skill.name, choice); setPending(null); }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
