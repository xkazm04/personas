// Skills Manager board — columnar layout (Name · Usage · Last used · Action)
// inside Exchange-style panels. Row actions are ICON-ONLY (Adopt ↓ / Share ↑ /
// Use ▶) and each opens a confirmation modal showing the skill's description
// before the LLM task or Fleet dispatch fires. Grouping renders as divider rows
// (left: category; right: context-tracked vs standard); sorting (Skill / Usage)
// applies WITHIN groups so the grouping survives a usage sort.
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpFromLine, CheckCircle2, Play } from 'lucide-react';

import type { SkillEntry } from '@/api/devTools/devTools';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';

import { isPresetSkill, presetVisual, SWEEP_SKILL_NAME } from '../constants/presetSkills';
import type { SkillsManagerVariantProps, ProjRow, WsRow } from './SkillsManagerPage';
import { CoverageBar, LastUsed, MemoryBindingButton, UsageCount } from './skillsManagerBits';
import { SkillActionConfirm } from './SkillActionConfirm';
import { SweepHeroRow } from './SweepHeroRow';
import { UseSkillDialog } from './UseSkillDialog';

type Pending = { kind: 'adopt' | 'share'; skill: SkillEntry } | { kind: 'use'; skill: SkillEntry; tracked: boolean };

type SortKey = 'name' | 'coverage' | 'usage' | 'lastused';
type SortDir = 'asc' | 'desc';

/** Action column width. FIXED, not `auto`: every row is its own grid, so an
 *  `auto` last column sizes to that row's own content — a project row with two
 *  icons then shifted Coverage/Usage/Last left by an icon's width relative to a
 *  one-icon row, and the header (a wider text label) matched neither. One fixed
 *  track wide enough for the two-icon case AND the "Action" label keeps every
 *  column flush across rows, panels and the header. Both templates spell the
 *  track out literally: Tailwind only extracts classes it can see as source
 *  text, so the width must not be interpolated in. */
const COLS = 'grid grid-cols-[minmax(0,1fr)_3.5rem_5.25rem_4rem] items-center gap-3';
/** Project-panel template — adds a dedicated Coverage column after the name. */
const PROJ_COLS = 'grid grid-cols-[minmax(0,1fr)_6.5rem_3.5rem_5.25rem_4rem] items-center gap-3';

function useSort(): { key: SortKey; dir: SortDir; toggle: (k: SortKey) => void } {
  const [key, setKey] = useState<SortKey>('name');
  const [dir, setDir] = useState<SortDir>('asc');
  const toggle = (k: SortKey) => {
    if (k === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    // Names read best A→Z; every data column defaults to highest-first.
    else { setKey(k); setDir(k === 'name' ? 'asc' : 'desc'); }
  };
  return { key, dir, toggle };
}

/** Per-row value extractors — one per sortable column. `coverage` is optional
 *  (only the project panel has that column). */
interface RowAccessors<T> {
  name: (r: T) => string;
  usage: (r: T) => number;
  lastused: (r: T) => number;
  coverage?: (r: T) => number;
}

function sortRows<T>(rows: T[], key: SortKey, dir: SortDir, acc: RowAccessors<T>): T[] {
  const tie = (a: T, b: T) => acc.name(a).localeCompare(acc.name(b));
  const cmp = (a: T, b: T): number => {
    switch (key) {
      case 'name': return tie(a, b);
      case 'usage': return acc.usage(a) - acc.usage(b) || tie(a, b);
      case 'lastused': return acc.lastused(a) - acc.lastused(b) || tie(a, b);
      case 'coverage': return (acc.coverage?.(a) ?? 0) - (acc.coverage?.(b) ?? 0) || tie(a, b);
    }
  };
  const sorted = [...rows].sort(cmp);
  return dir === 'desc' ? sorted.reverse() : sorted;
}

/** Last-invocation timestamp as a sortable number (0 = never). */
function lastUsedTs(usage: { last_invoked_at: string | null } | undefined): number {
  return usage?.last_invoked_at ? new Date(usage.last_invoked_at).getTime() : 0;
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

/** Column-header row (matches COLS/PROJ_COLS): every data column is sortable.
 *  Right-aligned headers place the sort arrow to the LEFT of the label so the
 *  label's right edge stays flush with the data cells whether or not the column
 *  is the active sort — the arrow appearing never nudges the label. */
function HeaderRow({ sort, coverage = false }: { sort: ReturnType<typeof useSort>; coverage?: boolean }) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const SortHead = ({ k, label, align = 'right' }: { k: SortKey; label: string; align?: 'left' | 'right' }) => {
    const on = sort.key === k;
    const Icon = sort.dir === 'asc' ? ArrowUp : ArrowDown;
    const arrow = on ? <Icon className="w-3 h-3 flex-shrink-0" aria-hidden /> : null;
    return (
      <button
        type="button"
        onClick={() => sort.toggle(k)}
        className={`inline-flex items-center gap-1 w-full text-[10.5px] uppercase tracking-[0.12em] transition-colors focus-ring rounded-interactive whitespace-nowrap ${align === 'right' ? 'justify-end' : 'justify-start'} ${on ? 'text-foreground/80 font-semibold' : 'text-foreground/40 hover:text-foreground/70'}`}
        data-testid={`skills-manager-sort-${k}`}
      >
        {align === 'right' && arrow}
        {label}
        {align === 'left' && arrow}
      </button>
    );
  };
  return (
    <div className={`${coverage ? PROJ_COLS : COLS} px-3 py-1.5 border-b border-primary/10 flex-shrink-0`}>
      <SortHead k="name" label={d.skills_sort_skill} align="left" />
      {coverage && <SortHead k="coverage" label={d.skills_col_coverage} />}
      <SortHead k="usage" label={d.skills_sort_usage} />
      <SortHead k="lastused" label={d.skills_col_lastused} />
      <span className="text-[10.5px] uppercase tracking-[0.12em] text-foreground/40 text-right whitespace-nowrap overflow-hidden">{d.skills_col_action}</span>
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

export function SkillsManagerBoard({ ws, proj, totalContexts, busy, projectName, projectId, onAdopt, onShare, onUse, onSwitchMemory, onOpenContexts, onOpenInfo }: SkillsManagerVariantProps) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const wsSort = useSort();
  const projSort = useSort();
  const [pending, setPending] = useState<Pending | null>(null);
  // Library group: app-owned presets (icon rows) vs user-authored skills.
  const [libTab, setLibTab] = useState<'preset' | 'custom'>('custom');
  // Preset tab: the 22 single-lens presets collapse behind the sweep hero row.
  const [rosterOpen, setRosterOpen] = useState(false);

  const libRows = useMemo(
    () => ws.filter((r) => isPresetSkill(r.entry.name) === (libTab === 'preset')),
    [ws, libTab],
  );
  const sweepRow = useMemo(
    () => (libTab === 'preset' ? libRows.find((r) => r.entry.name === SWEEP_SKILL_NAME) ?? null : null),
    [libRows, libTab],
  );

  // Left — grouped (name-asc), sorted within each group. Custom tab groups by
  // frontmatter category; Preset tab groups by the lens's category group so
  // the four scanner families read as one block each (the sweep hero row is
  // rendered separately, never inside a family group).
  const wsGroups = useMemo(() => {
    const byCat = new Map<string, WsRow[]>();
    const grouped = libTab === 'preset' ? libRows.filter((r) => r.entry.name !== SWEEP_SKILL_NAME) : libRows;
    for (const r of grouped) {
      const cat = libTab === 'preset'
        ? (presetVisual(r.entry.name)?.categoryGroup ?? 'Other')
        : (r.entry.category ?? 'Other');
      const list = byCat.get(cat);
      if (list) list.push(r); else byCat.set(cat, [r]);
    }
    return [...byCat.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, rows]) => [cat, sortRows(rows, wsSort.key, wsSort.dir, {
        name: (r) => r.entry.name,
        usage: (r) => r.usage?.invokes_30d ?? 0,
        lastused: (r) => lastUsedTs(r.usage),
      })] as const);
  }, [libRows, libTab, wsSort.key, wsSort.dir]);

  // Preset-tab divider labels — the four lens families, translated.
  const groupLabel = (cat: string): string => {
    if (libTab !== 'preset') return cat;
    if (cat === 'technical') return d.skills_preset_group_technical;
    if (cat === 'user') return d.skills_preset_group_user;
    if (cat === 'business') return d.skills_preset_group_business;
    if (cat === 'mastermind') return d.skills_preset_group_mastermind;
    return cat;
  };

  const projAcc: RowAccessors<ProjRow> = {
    name: (r) => r.entry.name,
    usage: (r) => r.usage?.invokes_30d ?? 0,
    lastused: (r) => lastUsedTs(r.usage),
    coverage: (r) => r.coverage?.coveredContexts ?? 0,
  };
  const tracked = useMemo(
    () => sortRows(proj.filter((r) => r.tracked), projSort.key, projSort.dir, projAcc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proj, projSort.key, projSort.dir],
  );
  const plain = useMemo(
    () => sortRows(proj.filter((r) => !r.tracked), projSort.key, projSort.dir, projAcc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proj, projSort.key, projSort.dir],
  );

  const confirmAdoptShare = () => {
    if (!pending || pending.kind === 'use') return;
    if (pending.kind === 'adopt') onAdopt(pending.skill.name);
    else onShare(pending.skill.name);
    setPending(null);
  };

  const renderProjRow = (r: ProjRow) => (
    <li key={r.entry.name} className={`${PROJ_COLS} py-2 border-b border-foreground/[0.08] last:border-b-0`}>
      {/* Name cell: memory icon + name (click → skill info modal) */}
      <span className="flex items-center gap-2 min-w-0">
        <MemoryBindingButton binding={r.entry.memory} onSwitch={(next) => onSwitchMemory(r.entry.name, next)} />
        <button
          type="button"
          onClick={() => onOpenInfo(r.entry.name)}
          className="min-w-0 text-left hover:text-primary transition-colors"
          data-testid={`skills-manager-proj-${r.entry.name}`}
        >
          <span className="typo-caption font-medium text-foreground truncate">{r.entry.name}</span>
        </button>
      </span>
      {/* Coverage — its own column; click opens the context-coverage detail. */}
      <span className="flex justify-end">
        {r.tracked
          ? (
            <button type="button" onClick={() => onOpenContexts(r.entry.name)} className="hover:opacity-80 transition-opacity" data-testid={`skills-manager-coverage-${r.entry.name}`}>
              <CoverageBar row={r.coverage} total={totalContexts} />
            </button>
          )
          : <span className="typo-label text-foreground/25">—</span>}
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
      <Panel
        title={d.skills_workspace_library}
        count={libRows.length}
        header={(
          <>
            <div className="px-3 pt-2 flex-shrink-0">
              <SegmentedTabs
                tabs={[
                  { id: 'custom', label: d.skills_lib_tab_custom },
                  { id: 'preset', label: d.skills_lib_tab_preset },
                ]}
                activeTab={libTab}
                onTabChange={(v) => setLibTab(v as 'preset' | 'custom')}
                variant="segment"
                size="sm"
                fullWidth={false}
                ariaLabel={d.skills_lib_tab_aria}
              />
            </div>
            <HeaderRow sort={wsSort} />
          </>
        )}
        footer={d.skills_footer_usage}
      >
        {libTab === 'preset' && sweepRow && (
          <SweepHeroRow
            row={sweepRow}
            projectName={projectName}
            busy={busy}
            rosterOpen={rosterOpen}
            lensCount={libRows.length - 1}
            onToggleRoster={() => setRosterOpen((o) => !o)}
            onInfo={onOpenInfo}
            onAdopt={(entry) => setPending({ kind: 'adopt', skill: entry })}
          />
        )}
        {(libTab !== 'preset' || rosterOpen) && wsGroups.map(([cat, rows]) => (
          <div key={cat}>
            <GroupDivider>{groupLabel(cat)}</GroupDivider>
            <ul>
              {rows.map(({ entry, usage, installed }) => {
                const visual = presetVisual(entry.name);
                return (
                <li key={entry.name} className={`${COLS} py-2 border-b border-foreground/[0.08] last:border-b-0`}>
                  <span className="flex items-center gap-2 min-w-0">
                    {visual && (
                      <span
                        className="inline-flex items-center justify-center w-5 h-5 rounded-interactive border flex-shrink-0"
                        style={{ color: visual.color, borderColor: `${visual.color}40`, backgroundColor: `${visual.color}14` }}
                        title={visual.label}
                      >
                        <visual.icon className="w-3 h-3" aria-hidden strokeWidth={1.75} />
                      </span>
                    )}
                    <button type="button" onClick={() => onOpenInfo(entry.name)}
                      className={`typo-caption font-medium truncate text-left hover:text-primary transition-colors ${installed ? 'text-foreground/45' : 'text-foreground'}`}
                      data-testid={`skills-manager-ws-${entry.name}`}>
                      {entry.name}
                    </button>
                  </span>
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
                );
              })}
            </ul>
          </div>
        ))}
        {libRows.length === 0 && (
          <p className="typo-caption text-foreground/45 py-8 text-center">
            {libTab === 'preset' ? d.skills_preset_empty : d.skills_ws_empty}
          </p>
        )}
      </Panel>

      <Panel title={projectName || d.skills_project_fallback} count={proj.length} header={<HeaderRow sort={projSort} coverage />} footer={d.skills_footer_usage_coverage}>
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
          preset={isPresetSkill(pending.skill.name)}
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
