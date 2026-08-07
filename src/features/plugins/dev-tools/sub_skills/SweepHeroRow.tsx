// Preset-tab hero row for the consolidated `scan-sweep` skill — the ONLY scan
// entry point (the 22 single-lens scan skills were retired 2026-08-04; a
// focused deep pass is `/scan-sweep --lenses <key> <context>`).
import { ArrowDownToLine, CheckCircle2 } from 'lucide-react';

import type { SkillEntry } from '@/api/devTools/devTools';
import { useTranslation } from '@/i18n/useTranslation';

import { presetVisual, SWEEP_SKILL_NAME } from '../constants/presetSkills';
import type { WsRow } from './SkillsManagerPage';
import { LastUsed, UsageCount } from './skillsManagerBits';

export function SweepHeroRow({ row, projectName, busy, onInfo, onAdopt }: {
  row: WsRow;
  projectName: string;
  busy: boolean;
  onInfo: (name: string) => void;
  onAdopt: (entry: SkillEntry) => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const visual = presetVisual(SWEEP_SKILL_NAME);

  return (
    <div className="rounded-card border border-primary/15 bg-primary/[0.05] px-3 py-2.5 mt-2" data-testid="sweep-hero-row">
      <div className="flex items-center gap-2.5">
        {visual && (
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-interactive border flex-shrink-0"
            style={{ color: visual.color, borderColor: `${visual.color}40`, backgroundColor: `${visual.color}14` }}
            title={visual.label}
          >
            <visual.icon className="w-3.5 h-3.5" aria-hidden strokeWidth={1.75} />
          </span>
        )}
        <button
          type="button"
          onClick={() => onInfo(row.entry.name)}
          className="min-w-0 text-left hover:text-primary transition-colors"
          data-testid="skills-manager-ws-scan-sweep"
        >
          <span className="typo-caption font-semibold text-foreground">{row.entry.name}</span>
        </button>
        <span className="flex-1" />
        <UsageCount usage={row.usage} />
        <LastUsed usage={row.usage} />
        {row.installed ? (
          <span title={tx(d.skills_installed_in, { name: projectName })} className="inline-flex p-1 flex-shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70" aria-label={tx(d.skills_installed_in, { name: projectName })} />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onAdopt(row.entry)}
            disabled={busy}
            title={tx(d.skills_adopt_hint, { name: projectName })}
            aria-label={tx(d.skills_adopt_hint, { name: projectName })}
            className="p-1 rounded-interactive text-primary hover:bg-primary/10 border border-primary/20 transition-colors disabled:opacity-30 flex-shrink-0"
            data-testid="skills-manager-adopt-scan-sweep"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" aria-hidden />
          </button>
        )}
      </div>
      <p className="typo-caption mt-1.5">{d.skills_sweep_hero_hint}</p>
    </div>
  );
}
