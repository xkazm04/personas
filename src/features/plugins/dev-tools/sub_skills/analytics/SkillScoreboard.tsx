// Skill performance — one row per installed skill: transcript usage, Memory
// Ledger coverage, fleet run outcomes, and (for scan-* presets) the ideas
// accept/impl rates carried over from the Agent Scoreboard.
import { useMemo, useState } from 'react';
import { ArrowUpDown, Trophy } from 'lucide-react';

import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

import { presetVisual } from '../../constants/presetSkills';
import type { ProjRow } from '../SkillsManagerPage';
import type { SkillRunRow } from './useSkillsAnalytics';

interface SkillScore {
  name: string;
  invokes30d: number;
  lastInvokedAt: string | null;
  coveredContexts: number;
  runsFinished: number;
  runsTotal: number;
  /** Ideas-based signals — presets only (agent-keyed legacy data). */
  acceptRate: number | null;
  implRate: number | null;
}

type SortKey = 'invokes' | 'coverage' | 'runs' | 'accept';

const TERMINAL_OK = new Set(['finished', 'idle']);
const LIVE = new Set(['spawning', 'running', 'awaiting_input']);

export function SkillScoreboard({ proj, totalContexts, runs }: {
  proj: ProjRow[];
  totalContexts: number;
  runs: SkillRunRow[];
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const ideas = useSystemStore((s) => s.ideas);
  const tasks = useSystemStore((s) => s.tasks);
  const [sort, setSort] = useState<SortKey>('invokes');

  const rows = useMemo((): SkillScore[] => {
    // Fleet run outcomes per skill.
    const runsBySkill = new Map<string, { finished: number; total: number }>();
    for (const r of runs) {
      if (r.kind !== 'fleet') continue;
      const cur = runsBySkill.get(r.skill) ?? { finished: 0, total: 0 };
      if (!LIVE.has(r.status)) cur.total += 1;
      if (TERMINAL_OK.has(r.status)) cur.finished += 1;
      runsBySkill.set(r.skill, cur);
    }

    // Ideas accept/impl per AGENT key (legacy linkage) → mapped to scan-* names.
    const ideaById = new Map(ideas.map((i) => [i.id, i]));
    const byAgent = new Map<string, { accepted: number; rejected: number; tasks: number; done: number }>();
    for (const idea of ideas) {
      const cur = byAgent.get(idea.scan_type) ?? { accepted: 0, rejected: 0, tasks: 0, done: 0 };
      if (idea.status === 'accepted') cur.accepted += 1;
      else if (idea.status === 'rejected') cur.rejected += 1;
      byAgent.set(idea.scan_type, cur);
    }
    for (const task of tasks) {
      if (!task.source_idea_id) continue;
      const src = ideaById.get(task.source_idea_id);
      if (!src) continue;
      const cur = byAgent.get(src.scan_type);
      if (!cur) continue;
      cur.tasks += 1;
      if (task.status === 'completed') cur.done += 1;
    }

    return proj.map((r) => {
      const run = runsBySkill.get(r.entry.name) ?? { finished: 0, total: 0 };
      const visual = presetVisual(r.entry.name);
      const agent = visual ? byAgent.get(visual.agentKey) : undefined;
      const decided = (agent?.accepted ?? 0) + (agent?.rejected ?? 0);
      return {
        name: r.entry.name,
        invokes30d: r.usage?.invokes_30d ?? 0,
        lastInvokedAt: r.usage?.last_invoked_at ?? null,
        coveredContexts: r.coverage?.coveredContexts ?? 0,
        runsFinished: run.finished,
        runsTotal: run.total,
        acceptRate: agent && decided > 0 ? agent.accepted / decided : null,
        implRate: agent && agent.tasks > 0 ? agent.done / agent.tasks : null,
      };
    });
  }, [proj, runs, ideas, tasks]);

  const sorted = useMemo(() => {
    const byNullableDesc = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    };
    const copy = [...rows];
    switch (sort) {
      case 'invokes': copy.sort((a, b) => b.invokes30d - a.invokes30d || a.name.localeCompare(b.name)); break;
      case 'coverage': copy.sort((a, b) => b.coveredContexts - a.coveredContexts || a.name.localeCompare(b.name)); break;
      case 'runs': copy.sort((a, b) => b.runsTotal - a.runsTotal || a.name.localeCompare(b.name)); break;
      case 'accept': copy.sort((a, b) => byNullableDesc(a.acceptRate, b.acceptRate) || a.name.localeCompare(b.name)); break;
    }
    return copy;
  }, [rows, sort]);

  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
  const rateTone = (v: number | null) =>
    v === null ? 'text-foreground/50' : v >= 0.66 ? 'text-status-success' : v >= 0.33 ? 'text-status-warning' : 'text-status-error';

  const GRID = 'grid grid-cols-[minmax(0,1.6fr)_4.5rem_5.5rem_4.5rem_4.5rem_4.5rem] items-center gap-3';
  const SortHead = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      type="button"
      onClick={() => setSort(k)}
      className={`inline-flex items-center justify-end gap-1 text-[10.5px] uppercase tracking-[0.12em] transition-colors ${sort === k ? 'text-foreground/80 font-semibold' : 'text-foreground/40 hover:text-foreground/70'}`}
    >
      {label}<ArrowUpDown className="w-3 h-3" aria-hidden />
    </button>
  );

  const top = sorted[0];

  return (
    <section className="rounded-card border border-primary/12 bg-secondary/[0.12]" data-testid="skill-scoreboard">
      <div className="flex items-baseline gap-2 px-3 py-2 bg-primary/[0.04] border-b border-primary/10 rounded-t-card">
        <span className="typo-body font-semibold text-foreground">{d.skills_scoreboard_title}</span>
        {top && top.invokes30d > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 typo-label text-foreground/50">
            <Trophy className="w-3 h-3 text-status-warning" aria-hidden />
            {tx(d.skills_scoreboard_top, { name: top.name })}
          </span>
        )}
      </div>
      <div className={`${GRID} px-3 py-1.5 border-b border-primary/10`}>
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-foreground/40">{d.skills_scoreboard_col_skill}</span>
        <SortHead k="invokes" label={d.skills_scoreboard_col_invokes} />
        <SortHead k="coverage" label={d.skills_scoreboard_col_coverage} />
        <SortHead k="runs" label={d.skills_scoreboard_col_runs} />
        <SortHead k="accept" label={d.skills_scoreboard_col_accept} />
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-foreground/40 text-right">{d.skills_scoreboard_col_impl}</span>
      </div>
      <div className="max-h-72 overflow-y-auto px-3">
        {sorted.length === 0 && (
          <p className="typo-caption text-foreground/45 py-8 text-center">{d.skills_scoreboard_empty}</p>
        )}
        <ul>
          {sorted.map((row) => {
            const visual = presetVisual(row.name);
            return (
              <li key={row.name} className={`${GRID} py-2 border-b border-foreground/[0.08] last:border-b-0`}>
                <span className="flex items-center gap-2 min-w-0">
                  {visual && (
                    <span
                      className="inline-flex items-center justify-center w-5 h-5 rounded-interactive border flex-shrink-0"
                      style={{ color: visual.color, borderColor: `${visual.color}40`, backgroundColor: `${visual.color}14` }}
                    >
                      <visual.icon className="w-3 h-3" aria-hidden strokeWidth={1.75} />
                    </span>
                  )}
                  <span className="typo-caption font-medium text-foreground truncate">{row.name}</span>
                </span>
                <span className="typo-caption text-foreground/70 tabular-nums text-right">{row.invokes30d || '—'}</span>
                <span className="typo-caption text-foreground/70 tabular-nums text-right">
                  {totalContexts > 0 ? `${row.coveredContexts}/${totalContexts}` : '—'}
                </span>
                <span className="typo-caption text-foreground/70 tabular-nums text-right">
                  {row.runsTotal > 0 ? `${row.runsFinished}/${row.runsTotal}` : '—'}
                </span>
                <span className={`typo-caption tabular-nums text-right ${rateTone(row.acceptRate)}`}>{pct(row.acceptRate)}</span>
                <span className={`typo-caption tabular-nums text-right ${rateTone(row.implRate)}`}>{pct(row.implRate)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
