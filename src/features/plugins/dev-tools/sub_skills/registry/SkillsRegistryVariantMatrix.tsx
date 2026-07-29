// Registry variant — MATRIX. Mental model: an instrument panel. A rigid,
// aligned table — sticky skill column, sticky project header carrying each
// project's identity + adoption total — where every adopted cell renders the
// literal contract: a coverage bar, the 30d usage count, and a use control.
// Un-adopted cells centre a single adopt control. The most legible / enterprise
// reading; reuses the shared CoverageBar so bars match the Overview board.
import { useMemo } from 'react';
import { ArrowDownToLine, Play } from 'lucide-react';

import { CoverageBar } from '../skillsManagerBits';
import { cellStatus, type RegistrySkill, type SkillsRegistryProps } from './registryTypes';

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const COL = '8rem';

export function SkillsRegistryMatrix({ model, adopting, onAdopt, onUse }: SkillsRegistryProps) {
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

  const template = `minmax(12rem,1fr) repeat(${projects.length}, ${COL})`;

  return (
    <div className="h-full flex flex-col rounded-card border border-primary/12 bg-secondary/[0.12] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto">
        {/* project header — identity chips */}
        <div className="grid sticky top-0 z-20 bg-secondary/[0.92] backdrop-blur border-b border-primary/10" style={{ gridTemplateColumns: template }}>
          <div className="px-3 py-2.5 typo-label text-foreground/40 sticky left-0 z-10 bg-secondary/[0.92]">Skill</div>
          {projects.map((p) => (
            <div key={p.id} className="px-2 py-2 border-l border-primary/[0.06] min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: model.workspace?.color ?? '#6366f1' }} />
                <span className="typo-caption font-medium text-foreground truncate">{p.name}</span>
              </div>
              <div className="typo-label text-foreground/40 tabular-nums mt-0.5">{p.adoptedCount}/{skills.length} adopted</div>
              {p.techStack.length > 0 && (
                <div className="typo-label text-foreground/30 truncate mt-0.5">{p.techStack.join(' · ')}</div>
              )}
            </div>
          ))}
        </div>

        {/* rows */}
        {grouped.map(({ cat, rows }) => (
          <div key={cat}>
            <div className="px-3 pt-2.5 pb-1 typo-label text-foreground/35 sticky left-0">{cat}</div>
            {rows.map((s) => {
              const hue = s.visual?.color ?? '#6366f1';
              return (
                <div key={s.name} className="grid items-stretch border-b border-foreground/[0.06] hover:bg-primary/[0.02]" style={{ gridTemplateColumns: template }}>
                  {/* skill identity (sticky) */}
                  <div className="px-3 py-2 flex items-center gap-2 min-w-0 sticky left-0 z-10 bg-secondary/[0.12]">
                    {s.visual && (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-interactive border flex-shrink-0"
                        style={{ color: hue, borderColor: withAlpha(hue, 0.25), backgroundColor: withAlpha(hue, 0.08) }}>
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
                    const testId = `registry-cell-${s.name}-${p.id}`;

                    if (status === 'adopted') {
                      return (
                        <div key={p.id} className={`px-2 py-2 border-l border-primary/[0.06] flex flex-col items-end justify-center gap-1 ${c.running ? 'bg-status-info/[0.06]' : ''}`}>
                          <CoverageBar row={c.coverage} total={p.totalContexts} />
                          <div className="flex items-center gap-2">
                            <span className="typo-label text-foreground/45 tabular-nums">{c.invokes30d ? `${c.invokes30d}×` : '—'}</span>
                            <button type="button" onClick={() => onUse(s.name, p.id)} aria-label={`Run ${s.name} in ${p.name}`}
                              className={`inline-flex items-center justify-center w-5 h-5 rounded-interactive text-primary hover:bg-primary/10 border border-primary/20 transition-colors ${c.running ? 'animate-pulse' : ''}`}
                              data-testid={testId}>
                              <Play className="w-3 h-3" aria-hidden />
                            </button>
                          </div>
                        </div>
                      );
                    }
                    const busy = status === 'adopting';
                    const blocked = status === 'blocked';
                    return (
                      <div key={p.id} className="px-2 py-2 border-l border-primary/[0.06] flex items-center justify-center">
                        <button type="button"
                          disabled={busy || blocked}
                          onClick={() => onAdopt(s.name, p.id)}
                          aria-label={blocked ? `${s.name} is running in ${p.name}` : `Adopt ${s.name} into ${p.name}`}
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-interactive border border-dashed border-primary/15 text-foreground/30 hover:text-primary hover:border-primary/40 hover:bg-primary/[0.06] transition-colors disabled:cursor-not-allowed ${busy ? 'animate-pulse opacity-60' : ''} ${blocked ? 'opacity-30' : ''}`}
                          data-testid={testId}>
                          <ArrowDownToLine className="w-3.5 h-3.5" aria-hidden />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
