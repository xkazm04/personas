/**
 * The two things the operator may tighten on one origin: which tools have to
 * ask first, and how many calls an agent gets per turn.
 *
 * TIGHTEN-ONLY, BY CONSTRUCTION. There is no "auto" affordance here and there
 * never should be: the repo refuses any class but `gated` with a `forbidden`
 * carrying `refused_loosening`, so a control that offered loosening would be a
 * button whose only outcome is a refusal. Clearing an override returns the
 * tool to the class the page's own manifest implied — that is the ONLY way
 * back up, and it is a reset, not a loosening.
 */
import { useState } from 'react';

import * as browserApi from '@/api/browser';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import { putSite } from '../../browserStore';
import { BROWSER_DEFAULT_BUDGET, type BrowserPageTool, type BrowserSite } from '../../types';

export default function PolicyTab({ site }: { site: BrowserSite }) {
  const { t } = useTranslation();
  const d = t.browser.detail;
  const [budget, setBudget] = useState(String(site.budget));

  const tools: BrowserPageTool[] = site.scan_report?.page_tools ?? [];

  const toggleOverride = (name: string, gated: boolean) => {
    browserApi
      .setSiteOverride(site.origin, name, gated ? 'gated' : null)
      .then(putSite)
      .catch(toastCatch('browser set override', d.policy_override_failed));
  };

  const saveBudget = async () => {
    const parsed = Number.parseInt(budget, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setBudget(String(site.budget));
      return;
    }
    try {
      putSite(await browserApi.upsertSite({ origin: site.origin, label: null, enabled: null, budget: parsed, created_by: null }));
    } catch (err) {
      setBudget(String(site.budget));
      toastCatch('browser set budget', d.policy_budget_failed)(err);
    }
  };

  return (
    <div className="space-y-4 min-w-0">
      <section className="space-y-2">
        <h2 className="typo-caption uppercase tracking-wider text-foreground">
          {d.policy_ask_first}
        </h2>
        <p className="typo-body text-foreground">{d.policy_description}</p>
        {tools.length === 0 ? (
          <p className="typo-body text-foreground">{d.policy_no_tools}</p>
        ) : (
          <ul className="space-y-1.5">
            {tools.map((tool) => (
              <li
                key={tool.name}
                className="flex items-center gap-2 px-3 py-2 rounded-card border border-primary/10 bg-background/40 min-w-0"
              >
                <span className="typo-body text-foreground font-mono truncate flex-1">{tool.name}</span>
                <AccessibleToggle
                  checked={site.overrides[tool.name] === 'gated'}
                  onChange={() => toggleOverride(tool.name, site.overrides[tool.name] !== 'gated')}
                  label={d.policy_ask_first}
                  size="sm"
                  data-testid={`whitelist-override-${tool.name}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="typo-caption uppercase tracking-wider text-foreground">
          {d.policy_budget}
        </h2>
        <p className="typo-body text-foreground">{d.policy_budget_hint}</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            aria-label={d.policy_budget}
            placeholder={String(BROWSER_DEFAULT_BUDGET)}
            className={`${INPUT_FIELD} w-28`}
            data-testid={`whitelist-budget-${site.origin}`}
          />
          <AsyncButton size="sm" variant="secondary" onClick={saveBudget}>
            {d.policy_budget_save}
          </AsyncButton>
        </div>
      </section>
    </div>
  );
}
