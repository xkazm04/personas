// Registry variant — HEATMAP. Mental model: a GitHub-contribution field. The
// whole matrix reads as one colour grid — each adopted cell fills with its
// skill's lens colour at an intensity proportional to context coverage, so you
// read the *shape* of adoption across the workspace at a glance. Dense, square
// cells; the coverage "bar" is the cell fill itself, usage + use surface on
// hover. Unadopted cells are faint with an adopt affordance.
import { useMemo, useState } from 'react';
import { ArrowDownToLine, Play } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { cellStatus, coveragePct, type RegistrySkill, type SkillsRegistryProps } from './registryTypes';

/** hex (#RRGGBB) → rgba with the given alpha. */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const COL = '3.75rem';
const NEUTRAL = 'rgba(148,163,184,.9)';

export function SkillsRegistryHeatmap({ model, adopting, onAdopt, onUse }: SkillsRegistryProps) {
  const { projects, skills } = model;
  const [hover, setHover] = useState<string | null>(null);

  // Category dividers within the skill column.
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
        {/* header */}
        <div className="grid sticky top-0 z-20 bg-secondary/[0.9] backdrop-blur border-b border-primary/10" style={{ gridTemplateColumns: template }}>
          <div className="px-3 py-2 typo-label text-foreground/40 sticky left-0 z-10 bg-secondary/[0.9]">Skill</div>
          {projects.map((p) => (
            <Tooltip key={p.id} content={`${p.name} — ${p.adoptedCount}/${skills.length} adopted · ${p.totalContexts} contexts`} placement="top">
              <div className="px-1 py-2 flex flex-col items-center gap-1 min-w-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: model.workspace?.color ?? NEUTRAL }} />
                <span className="typo-label text-foreground/55 truncate max-w-full">{p.name}</span>
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
                {/* skill label (sticky) */}
                <div className="px-3 py-1 flex items-center gap-2 min-w-0 sticky left-0 z-10 bg-secondary/[0.12]">
                  {s.visual && (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-interactive border flex-shrink-0"
                      style={{ color: s.visual.color, borderColor: withAlpha(s.visual.color, 0.25), backgroundColor: withAlpha(s.visual.color, 0.08) }}>
                      <s.visual.icon className="w-3 h-3" aria-hidden strokeWidth={1.75} />
                    </span>
                  )}
                  <span className="typo-caption font-medium text-foreground truncate">{s.name}</span>
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
                        title={`${p.name}: ${pct}% coverage · ${c.invokes30d}× · run ${s.name}`}
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
                      title={blocked ? `${s.name} is running in ${p.name}` : `Adopt ${s.name} into ${p.name}`}
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
          coverage
          {[0.2, 0.45, 0.7, 0.95].map((a) => (
            <span key={a} className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: withAlpha('#6366f1', a) }} />
          ))}
        </span>
        <span className="flex items-center gap-1"><Play className="w-3 h-3" aria-hidden /> use</span>
        <span className="flex items-center gap-1"><ArrowDownToLine className="w-3 h-3" aria-hidden /> adopt</span>
      </div>
    </div>
  );
}
