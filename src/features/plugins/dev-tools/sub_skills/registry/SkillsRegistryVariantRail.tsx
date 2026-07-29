// Registry variant — RAIL. Mental model: reach. Each skill is one narrative
// row — identity + an aggregate "live in N/M · K× invokes" — followed by a
// horizontal rail of project pills that shows *where* the skill has landed.
// Adopted pills are solid (coverage % + usage + a use control); un-adopted
// pills are dashed with an adopt control. Pills wrap, so the layout scales to
// many projects without rigid columns.
import { useMemo } from 'react';
import { ArrowDownToLine, Play } from 'lucide-react';

import { cellStatus, coveragePct, type RegistrySkill, type SkillsRegistryProps } from './registryTypes';

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const HUE_FALLBACK = '#6366f1';

export function SkillsRegistryRail({ model, adopting, onAdopt, onUse }: SkillsRegistryProps) {
  const { projects, skills } = model;

  const grouped = useMemo(() => {
    const out: Array<{ cat: string; rows: RegistrySkill[] }> = [];
    for (const s of skills) {
      const last = out[out.length - 1];
      if (last && last.cat === s.category) last.rows.push(s);
      else out.push({ cat: s.category, rows: [s] });
    }
    return out;
  }, [skills]);

  return (
    <div className="h-full overflow-y-auto rounded-card border border-primary/12 bg-secondary/[0.12] px-3 py-2">
      {grouped.map(({ cat, rows }) => (
        <div key={cat} className="mb-1">
          <div className="flex items-center gap-2 pt-3 pb-1.5">
            <span className="typo-label text-foreground/35 flex-shrink-0">{cat}</span>
            <span className="flex-1 h-px bg-foreground/10" />
          </div>
          <ul className="space-y-1.5">
            {rows.map((s) => {
              const hue = s.visual?.color ?? HUE_FALLBACK;
              const reach = projects.length > 0 ? s.adoptedCount / projects.length : 0;
              return (
                <li key={s.name} className="flex items-start gap-3 rounded-card border border-primary/10 bg-background/30 px-3 py-2">
                  {/* identity + aggregate */}
                  <div className="w-52 flex-shrink-0 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {s.visual && (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-interactive border flex-shrink-0"
                          style={{ color: hue, borderColor: withAlpha(hue, 0.25), backgroundColor: withAlpha(hue, 0.08) }}>
                          <s.visual.icon className="w-3 h-3" aria-hidden strokeWidth={1.75} />
                        </span>
                      )}
                      <span className="typo-caption font-medium text-foreground truncate">{s.name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="w-16 h-[4px] rounded-full bg-foreground/10 overflow-hidden flex-shrink-0">
                        <span className="block h-full rounded-full" style={{ width: `${reach * 100}%`, background: hue }} />
                      </span>
                      <span className="typo-label text-foreground/45 tabular-nums">{s.adoptedCount}/{projects.length}</span>
                      {s.totalInvokes > 0 && <span className="typo-label text-foreground/35 tabular-nums">· {s.totalInvokes}×</span>}
                    </div>
                  </div>

                  {/* project rail */}
                  <div className="flex-1 flex flex-wrap gap-1.5 min-w-0">
                    {projects.map((p) => {
                      const c = model.cell(s.name, p.id);
                      const status = cellStatus(c, adopting, s.name, p.id);
                      const pct = coveragePct(c, p.totalContexts);
                      const testId = `registry-cell-${s.name}-${p.id}`;

                      if (status === 'adopted') {
                        return (
                          <span key={p.id}
                            className={`inline-flex items-center gap-1.5 h-6 pl-2 pr-1 rounded-full border ${c.running ? 'border-status-info/50' : 'border-primary/20'} bg-primary/[0.06]`}
                            style={{ borderColor: c.running ? undefined : withAlpha(hue, 0.35), backgroundColor: withAlpha(hue, 0.08) }}
                          >
                            <span className="typo-label text-foreground/70 truncate max-w-[7rem]">{p.name}</span>
                            <span className="typo-label tabular-nums" style={{ color: hue }}>{pct}%</span>
                            {c.invokes30d > 0 && <span className="typo-label text-foreground/40 tabular-nums">{c.invokes30d}×</span>}
                            <button type="button" onClick={() => onUse(s.name, p.id)} aria-label={`Run ${s.name} in ${p.name}`}
                              className="inline-flex items-center justify-center w-4 h-4 rounded-full text-primary hover:bg-primary/15 transition-colors"
                              data-testid={testId}>
                              <Play className="w-2.5 h-2.5" aria-hidden />
                            </button>
                          </span>
                        );
                      }
                      const busy = status === 'adopting';
                      const blocked = status === 'blocked';
                      return (
                        <button key={p.id} type="button"
                          disabled={busy || blocked}
                          onClick={() => onAdopt(s.name, p.id)}
                          aria-label={blocked ? `${s.name} is running in ${p.name}` : `Adopt ${s.name} into ${p.name}`}
                          className={`inline-flex items-center gap-1 h-6 pl-2 pr-1.5 rounded-full border border-dashed border-primary/15 text-foreground/40 hover:text-primary hover:border-primary/40 hover:bg-primary/[0.05] transition-colors disabled:cursor-not-allowed ${busy ? 'animate-pulse opacity-60' : ''} ${blocked ? 'opacity-40' : ''}`}
                          data-testid={testId}>
                          <span className="typo-label truncate max-w-[7rem]">{p.name}</span>
                          <ArrowDownToLine className="w-2.5 h-2.5 flex-shrink-0" aria-hidden />
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
