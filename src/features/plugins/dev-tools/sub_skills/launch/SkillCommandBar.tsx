// The Launch tab's skill selector bar: a filterable ThemedSelect over the
// registry library, plus the selected skill's meta line (version - category),
// its description one-liner, and the "Athena stewards the run" caption.
// Shared by Launchpad (and importable by any other variant).
import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';

import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import { TruncateWithTooltip } from '@/features/shared/components/display/TruncateWithTooltip';
import { useTranslation } from '@/i18n/useTranslation';

import type { SkillLaunchData } from './launchTypes';

/** Unversioned skills render as the implicit "1.0" (SkillEntry contract). */
const IMPLICIT_VERSION = '1.0';

export function SkillCommandBar({ data }: { data: SkillLaunchData }) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;

  // useSkillLaunch already sorts name-asc; map to select options.
  const options: ThemedSelectOption[] = useMemo(
    () => data.skills.map((s) => ({ value: s.name, label: s.name })),
    [data.skills],
  );

  const selected = data.selectedSkill
    ? data.skills.find((s) => s.name === data.selectedSkill) ?? null
    : null;

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2" data-testid="skill-launch-command-bar">
      <ThemedSelect
        filterable
        hideSearch={options.length <= 8}
        options={options}
        value={data.selectedSkill ?? ''}
        onValueChange={(v) => data.setSelectedSkill(v || null)}
        placeholder={d.launch_select_skill}
        aria-label={d.launch_select_skill}
        wrapperClassName="w-64 flex-shrink-0"
      />

      {selected && (
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="typo-label text-foreground flex-shrink-0">
              {tx(d.launch_skill_meta, {
                version: selected.version ?? IMPLICIT_VERSION,
                category: selected.category ?? d.launch_ungrouped,
              })}
            </span>
            {selected.description && (
              <TruncateWithTooltip
                text={selected.description}
                className="typo-caption text-foreground min-w-0"
              />
            )}
          </div>
          <p className="typo-caption text-foreground flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-primary/60 flex-shrink-0" aria-hidden />
            {d.launch_via_athena_hint}
          </p>
        </div>
      )}
    </div>
  );
}
