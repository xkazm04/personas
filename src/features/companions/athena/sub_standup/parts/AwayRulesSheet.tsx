import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { MODAL_SECTION_HEAD, ModalShell } from '@/features/shared/components/modals/ModalShell';
import { useTranslation } from '@/i18n/useTranslation';
import type { AwayRuleClass } from '@/lib/bindings/AwayRuleClass';
import type { AwayRules } from '@/lib/bindings/AwayRules';
import { LOCKED_CLASSES, RULE_CLASSES, useRuleLabels } from './ruleLabels';

interface Props {
  open: boolean;
  rules: AwayRules;
  editable: boolean;
  projectNames: Readonly<Record<string, string>>;
  onClose: () => void;
  onChange: (rules: AwayRules) => void;
}

/** Move one class between "she decides alone" and "parks for you". */
function toggled(rules: AwayRules, k: AwayRuleClass): AwayRules {
  const delegated = rules.delegate.includes(k);
  return {
    ...rules,
    delegate: delegated ? rules.delegate.filter((x) => x !== k) : [...rules.delegate, k],
    park: delegated ? [...rules.park, k] : rules.park.filter((x) => x !== k),
  };
}

/** B/1's away-rules sheet (R): what Athena decides alone while you are away, and what always waits. */
export function AwayRulesSheet({ open, rules, editable, projectNames, onClose, onChange }: Props) {
  const { t } = useTranslation();
  const s = t.athena.standup.rules;
  const label = useRuleLabels();
  const free = RULE_CLASSES.filter((k) => !LOCKED_CLASSES.includes(k));
  return (
    <ModalShell isOpen={open} onClose={onClose} titleId="standup-away-rules" width="lg" title={s.title} subtitle={editable ? s.subtitle : s.subtitle_locked} portal>
      <div className="grid gap-6 md:grid-cols-3">
        <section className="flex flex-col gap-3">
          <h3 className={MODAL_SECTION_HEAD}>{s.decides_alone}</h3>
          {free.map((k) => (
            <div key={k} className="flex items-start gap-3">
              <AccessibleToggle checked={rules.delegate.includes(k)} onChange={() => onChange(toggled(rules, k))} label={label(k)} disabled={!editable} size="sm" />
              <div>
                <p className="typo-body text-foreground">{label(k)}</p>
                <p className="typo-caption">{s.notes[k]}</p>
              </div>
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-3">
          <h3 className={MODAL_SECTION_HEAD}>{s.always_waits}</h3>
          {LOCKED_CLASSES.map((k) => (
            <div key={k}>
              <p className="typo-body text-foreground"><span className="su-chip su-chip--lock typo-label">{label(k)}</span></p>
              <p className="typo-caption mt-1">{s.notes[k]}</p>
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-3">
          <h3 className={MODAL_SECTION_HEAD}>{s.pushes}</h3>
          {rules.pushTargets.length === 0
            ? <p className="typo-caption">{s.no_pushes}</p>
            : rules.pushTargets.map((p) => (
              <p key={`${p.projectId}:${p.remote}/${p.branch}`} className="typo-body text-foreground">
                {projectNames[p.projectId] ?? p.projectId} <span className="typo-code">{p.remote}/{p.branch}</span>
              </p>
            ))}
          <p className="typo-caption">{s.pushes_note}</p>
        </section>
      </div>
    </ModalShell>
  );
}
