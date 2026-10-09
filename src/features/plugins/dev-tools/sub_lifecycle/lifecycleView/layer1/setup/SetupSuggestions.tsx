/**
 * The coverage commands the setup suggests when the checklist has none: one
 * line each - "Suggested", the command, what it needs installed first - and
 * Add, which puts it on the checklist (on, marked suggested). Adding saves
 * nothing; the reader's Save and Measure does. Taking one hides the rest,
 * since they are alternatives.
 */
import { Plus } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { useLifecycleViewModel } from '../../context';
import { LC_RULE } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { Pill } from '../../system/Pill';
import { GLYPH } from '../../system/scales';
import type { TemplateId } from './setupModel';
import { SUGGESTED_LOOK } from './SetupRowView';
import type { SetupState } from './useSetup';

export function SetupSuggestions({ setup }: { setup: SetupState }) {
  const { dl, tx } = useLifecycleViewModel();
  if (setup.templates.length === 0) return null;
  const name: Record<TemplateId, string> = { vitest: dl.lcx10_tpl_vitest, jest: dl.lcx10_tpl_jest, 'llvm-cov': dl.lcx10_tpl_llvm_cov };
  return (
    <div className={`mt-2 border-t pt-2 ${LC_RULE}`} data-testid="lc10-setup-suggestions">
      <p className={LT.row}>{dl.lcx10_setup_suggest_title}</p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {setup.templates.map((t) => (
          <li key={t.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" data-testid={`lc10-setup-tpl-${t.id}`}>
            <Pill look={SUGGESTED_LOOK} label={name[t.id]} />
            <Tooltip content={t.command}>
              <span className={`min-w-0 flex-1 truncate ${LT.code}`}>{t.command}</span>
            </Tooltip>
            {t.needsInstall && <span className={LT.meta}>{dl.lcx10_tpl_needs_install}</span>}
            <Button
              variant="secondary"
              size="xs"
              icon={<Plus className={GLYPH.sm} />}
              aria-label={tx(dl.lcx10_setup_add_label, { command: t.command })}
              onClick={() => setup.addTemplate(t)}
              data-testid={`lc10-setup-add-${t.id}`}
            >
              {dl.lcx10_setup_add}
            </Button>
          </li>
        ))}
      </ul>
      <p className={`mt-1.5 ${LT.meta}`}>{dl.lcx10_setup_suggest_hint}</p>
    </div>
  );
}
