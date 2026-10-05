/**
 * The two things the operator may tighten on one origin: which tools have to
 * ask first, and how many calls an agent gets per turn. Ported from the Detail
 * layout's Policy tab (spark server-control) as draft fields the site modal
 * saves.
 *
 * TIGHTEN-ONLY, BY CONSTRUCTION. There is no "auto" affordance here and there
 * never should be: the repo refuses any class but `gated` with a `forbidden`
 * carrying `refused_loosening`, so a control that offered loosening would be a
 * switch whose only outcome is a refusal. Switching one off clears the
 * override, which returns the tool to the class the page's own manifest
 * implied: that is the ONLY way back up, and it is a reset, not a loosening.
 */
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { FormField } from '@/features/shared/components/forms/FormField';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import { BROWSER_DEFAULT_BUDGET } from '../types';

interface SitePolicyFieldsProps {
  gated: Readonly<Record<string, boolean>>;
  onGatedChange: (tool: string, gated: boolean) => void;
  budget: string;
  onBudgetChange: (raw: string) => void;
  budgetError: string | undefined;
}

export default function SitePolicyFields({
  gated,
  onGatedChange,
  budget,
  onBudgetChange,
  budgetError,
}: SitePolicyFieldsProps) {
  const { t } = useTranslation();
  const a = t.browser.add_site;
  const tools = Object.keys(gated).sort();

  return (
    <>
      <div className="space-y-2">
        <div className="typo-heading text-foreground">{a.policy_label}</div>
        <p className="typo-caption">{a.policy_hint}</p>
        {tools.length === 0 ? (
          <p className="typo-body text-foreground">{a.policy_no_tools}</p>
        ) : (
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {tools.map((tool) => (
              <li
                key={tool}
                className="flex items-center gap-2 px-3 py-2 rounded-card border border-primary/10 bg-background/40 min-w-0"
              >
                <span className="typo-body text-foreground font-mono truncate flex-1">{tool}</span>
                <AccessibleToggle
                  checked={gated[tool] === true}
                  onChange={() => onGatedChange(tool, gated[tool] !== true)}
                  label={`${a.policy_label}: ${tool}`}
                  size="sm"
                  data-testid={`whitelist-override-${tool}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <FormField label={a.budget_label} hint={a.budget_hint} error={budgetError} validateOn="change">
        {(inputProps) => (
          <input
            {...inputProps}
            type="text"
            inputMode="numeric"
            value={budget}
            onChange={(e) => onBudgetChange(e.target.value)}
            placeholder={String(BROWSER_DEFAULT_BUDGET)}
            className={`${INPUT_FIELD} w-28 tabular-nums`}
            data-testid="whitelist-edit-budget"
          />
        )}
      </FormField>
    </>
  );
}
