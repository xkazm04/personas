/**
 * The four authority levels - how much she may do before a person answers for
 * it, per kind of work.
 *
 * `L0` is the default for all four and it is ALWAYS ASK: an autonomy setting
 * that has never been touched must not be read as permission. The Rust
 * validator refuses anything outside `L0..L3` rather than falling back to a
 * default, which is the shape of setting that otherwise silently does not take.
 */
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import type { CuratorDecisionLevel } from '@/lib/bindings/CuratorDecisionLevel';
import type { CuratorPolicy } from '@/lib/bindings/CuratorPolicy';

import { PolicyRow } from './PolicyRow';
import {
  CURATOR_LEVEL_CONFORM,
  CURATOR_LEVEL_FORGE,
  CURATOR_LEVEL_RESEARCH,
  CURATOR_LEVEL_SWEEP,
  LEVELS,
} from './curatorPolicyKeys';

export function CuratorAuthoritySection({ policy, write }: {
  policy: CuratorPolicy | null;
  write: (key: string, value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const s = t.companions.setup;

  const options = LEVELS.map((level) => ({
    value: level,
    label: s.curator_level[level],
    description: s.curator_level_gloss[level],
  }));

  const rows: { key: string; label: string; description: string; value: CuratorDecisionLevel | undefined }[] = [
    {
      key: CURATOR_LEVEL_RESEARCH,
      label: s.curator_level_research,
      description: s.curator_level_research_desc,
      value: policy?.levelResearch,
    },
    {
      key: CURATOR_LEVEL_FORGE,
      label: s.curator_level_forge,
      description: s.curator_level_forge_desc,
      value: policy?.levelForge,
    },
    {
      key: CURATOR_LEVEL_CONFORM,
      label: s.curator_level_conform,
      description: s.curator_level_conform_desc,
      value: policy?.levelConform,
    },
    {
      key: CURATOR_LEVEL_SWEEP,
      label: s.curator_level_sweep,
      description: s.curator_level_sweep_desc,
      value: policy?.levelSweep,
    },
  ];

  return (
    <section className="space-y-2" data-testid="curator-authority">
      <h3 className="typo-title">{s.curator_authority_title}</h3>
      <p className="typo-caption text-foreground opacity-70">{s.curator_authority_desc}</p>
      {rows.map((row) => (
        <PolicyRow
          key={row.key}
          label={row.label}
          description={row.description}
          control={
            <ThemedSelect
              filterable
              hideSearch
              options={options}
              // No value until the policy read answered: a select showing `L0`
              // over an unread policy would claim she is on always-ask when
              // nobody knows what she is on.
              value={row.value ?? ''}
              placeholder={s.curator_policy_unread}
              disabled={!policy}
              wrapperClassName="w-44"
              aria-label={row.label}
              data-testid={`curator-select-${row.key}`}
              onValueChange={(next) => void write(row.key, next)}
            />
          }
        />
      ))}
    </section>
  );
}
