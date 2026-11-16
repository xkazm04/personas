// Preset-tab hero row for the consolidated `scan-sweep` skill — the ONLY scan
// entry point (the 22 single-lens scan skills were retired 2026-08-04; a
// focused deep pass is `/scan-sweep --lenses <key> <context>`).
import { ArrowDownToLine, CheckCircle2 } from 'lucide-react';

import type { SkillEntry } from '@/api/devTools/devTools';
import { useTranslation } from '@/i18n/useTranslation';

import { presetVisual, SWEEP_SKILL_NAME } from '../constants/presetSkills';
import type { WsRow } from './SkillsManagerPage';
import { LastUsed, UsageCount } from './skillsManagerBits';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PressSurface } from '@/features/shared/components/buttons';

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
    <div className="rounded-card border border-hair bg-surface-2 px-3 py-2.5 mt-2" data-testid="sweep-hero-row">
      <div className="flex items-center gap-2.5">
        {visual && (
          <Tooltip content={visual.label}><span
            className="inline-flex items-center justify-center w-6 h-6 rounded-interactive border flex-shrink-0"
            style={{ color: visual.color, borderColor: `${visual.color}40`, backgroundColor: `${visual.color}14` }}
          >
            <visual.icon className="w-3.5 h-3.5" aria-hidden strokeWidth={1.75} />
          </span></Tooltip>
        )}
        <PressSurface
          onPress={() => onInfo(row.entry.name)}
          data-testid="skills-manager-ws-scan-sweep"
          className="min-w-0 hover:text-primary"
        >
          <span className="typo-caption text-foreground">{row.entry.name}</span>
        </PressSurface>
        <span className="flex-1" />
        <UsageCount usage={row.usage} />
        <LastUsed usage={row.usage} />
        {row.installed ? (
          <Tooltip content={tx(d.skills_installed_in, { name: projectName })}><span className="inline-flex p-1 flex-shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5 text-status-success" aria-label={tx(d.skills_installed_in, { name: projectName })} />
          </span></Tooltip>
        ) : (
          <Button variant="secondary" size="icon-sm"
            type="button"
            onClick={() => onAdopt(row.entry)}
            disabled={busy}
            tooltip={tx(d.skills_adopt_hint, { name: projectName })}
            aria-label={tx(d.skills_adopt_hint, { name: projectName })}
            data-testid="skills-manager-adopt-scan-sweep"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" aria-hidden />
          </Button>
        )}
      </div>
      <p className="typo-caption mt-1.5">{d.skills_sweep_hero_hint}</p>
    </div>
  );
}
