// Registry — workspace coverage heatmap. Mental model: a GitHub-contribution
// field. Library skills (rows, grouped by category) × the workspace's projects
// (columns). Each adopted cell fills with its skill's lens colour at an
// intensity proportional to context coverage, so the *shape* of adoption reads
// at a glance. Project headers run vertically to keep columns narrow (height,
// not width). The skill name is a button → the shared SkillInfoModal.
import { useMemo, useState } from 'react';
import { ArrowDownToLine, Play } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { cellStatus, coveragePct, type RegistrySkill, type SkillsRegistryProps } from './registryTypes';

/** hex (#RRGGBB) → rgba with the given alpha. */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const COL = '2.25rem';
const NEUTRAL = 'rgba(148,163,184,.9)';
const VERTICAL: React.CSSProperties = { writingMode: 'vertical-rl', transform: 'rotate(180deg)' };

export function RegistryHeatmap({ model, adopting, onAdopt, onUse, onOpenInfo }: SkillsRegistryProps & {
  onOpenInfo: (skill: string) => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const { projects, skills } = model;
  const [hover, setHover] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const out: Array<{ cat: string; rows: RegistrySkill[] }> = [];
    for (const s of skills) {
      const last = out[out.length - 1];
      if (last && last.cat === s.category) last.rows.push(s);
      else out.push({ cat: s.category, rows: [s] });
    }
    return out;
  }, [skills]);

  const template = `minmax(11rem,1fr) repeat(${projects.length}, ${COL})`;

  return (
    <div className="h-full flex flex-col rounded-card border border-primary/12 bg-secondary/[0.12] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto">
        {/* header — subtle primary tint (matches panel/modal headers), vertical project names */}
        <div className="grid sticky top-0 z-20 bg-primary/[0.04] backdrop-blur border-b border-primary/10" style={{ gridTemplateColumns: template }}>
          <div className="px-3 py-2 flex items-end typo-label text-foreground/40 sticky left-0 z-10 bg-primary/[0.04] backdrop-blur">{d.skills_sort_skill}</div>
          {projects.map((p) => (
            <Tooltip key={p.id} content={tx(d.skills_registry_project_hint, { name: p.name, adopted: p.adoptedCount, total: skills.length, contexts: p.totalContexts })} placement="top">
              <div className="h-24 flex flex-col items-center justify-end gap-1.5 pb-1.5 min-w-0">
                <span className="typo-label text-foreground/55 leading-none whitespace-nowrap overflow-hidden max-h-[5rem]" style={VERTICAL}>{p.name}</span>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: model.workspace?.color ?? NEUTRAL }} />
              </div>
            </Tooltip>
          ))}
        </div>

        {/* body */}
        {grouped.map(({ cat, rows }) => (
          <div key={cat}>
            <div className="px-3 pt-3 pb-1 typo-label text-foreground/35 sticky left-0">{cat}</div>
            {rows.map((s) => (
              <div key={s.name} className="grid items-center hover:bg-primary/[0.03]" style={{ gridTemplateColumns: template }}>
                {/* skill label (sticky) — click opens the info modal */}
                <div className="px-3 py-1 flex items-center gap-2 min-w-0 sticky left-0 z-10 bg-secondary/[0.12] backdrop-blur">
                  {s.visual && (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-interactive border flex-shrink-0"
                      style={{ color: s.visual.color, borderColor: withAlpha(s.visual.color, 0.25), backgroundColor: withAlpha(s.visual.color, 0.08) }}>
                      <s.visual.icon className="w-3 h-3" aria-hidden strokeWidth={1.75} />
                    </span>
                  )}
                  <button type="button" onClick={() => onOpenInfo(s.name)}
                    className="typo-caption font-medium text-foreground truncate text-left hover:text-primary transition-colors"
                    data-testid={`registry-skill-${s.name}`}>
                    {s.name}
                  </button>
                  <span className="ml-auto typo-label text-foreground/35 tabular-nums flex-shrink-0">{s.adoptedCount}/{projects.length}</span>
                </div>
                {/* cells */}
                {projects.map((p) => {
                  const c = model.cell(s.name, p.id);
                  const status = cellStatus(c, adopting, s.name, p.id);
                  const pct = coveragePct(c, p.totalContexts);
                  const hue = s.visual?.color ?? '#6366f1';
                  const key = `${s.name}|${p.id}`;
                  const isHover = hover === key;

                  if (status === 'adopted') {
                    return (
                      <button key={p.id} type="button"
                        onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover((h) => (h === key ? null : h))}
                        onClick={() => onUse(s.name, p.id)}
                        aria-label={tx(d.skills_registry_use_cell, { skill: s.name, project: p.name })}
                        className={`relative h-8 mx-0.5 my-0.5 rounded-interactive flex items-center justify-center transition-colors ${c.running ? 'ring-2 ring-status-info/60' : ''}`}
                        style={{ backgroundColor: withAlpha(hue, 0.15 + (pct / 100) * 0.55) }}
                        data-testid={`registry-cell-${s.name}-${p.id}`}
                      >
                        {isHover
                          ? <Play className="w-3.5 h-3.5 text-foreground" aria-hidden />
                          : <span className="typo-label tabular-nums text-foreground/90">{pct}%</span>}
                        {c.invokes30d > 0 && !isHover && (
                          <span className="absolute bottom-0 right-0.5 typo-label text-foreground/40 leading-none" style={{ fontSize: '0.55rem' }}>{c.invokes30d}</span>
                        )}
                      </button>
                    );
                  }
                  const busy = status === 'adopting';
                  const blocked = status === 'blocked';
                  return (
                    <button key={p.id} type="button"
                      disabled={busy || blocked}
                      onClick={() => onAdopt(s.name, p.id)}
                      aria-label={blocked
                        ? tx(d.skills_registry_running_cell, { skill: s.name, project: p.name })
                        : tx(d.skills_registry_adopt_cell, { skill: s.name, project: p.name })}
                      className={`h-8 mx-0.5 my-0.5 rounded-interactive border border-dashed border-primary/15 flex items-center justify-center text-foreground/30 hover:text-primary hover:border-primary/40 hover:bg-primary/[0.06] transition-colors disabled:cursor-not-allowed ${busy ? 'animate-pulse opacity-60' : ''} ${blocked ? 'opacity-30' : ''}`}
                      data-testid={`registry-cell-${s.name}-${p.id}`}
                    >
                      <ArrowDownToLine className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* legend */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-primary/10 flex-shrink-0 typo-label text-foreground/40">
        <span className="flex items-center gap-1">
          {d.skills_col_coverage}
          {[0.2, 0.45, 0.7, 0.95].map((a) => (
            <span key={a} className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: withAlpha('#6366f1', a) }} />
          ))}
        </span>
        <span className="flex items-center gap-1"><Play className="w-3 h-3" aria-hidden /> {d.skills_registry_legend_use}</span>
        <span className="flex items-center gap-1"><ArrowDownToLine className="w-3 h-3" aria-hidden /> {d.skills_registry_legend_adopt}</span>
      </div>
    </div>
  );
}
