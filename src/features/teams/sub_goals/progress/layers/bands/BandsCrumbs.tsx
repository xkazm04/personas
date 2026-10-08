/**
 * The BANDS breadcrumb bar: where the operator is, as a door back up per level.
 *
 *   [<-]  PORTFOLIO · PROJECT              (the kit trail: the levels above)
 *         Milestone name                   (the current level, large)
 *
 * The kit `Crumbs` carries the levels above, the current level is the bar's
 * title - the kit's own rule, so the name is not said twice.
 */
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Crumbs, KitHost, type Crumb } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { LayerNav } from '../useLayers';

export function BandsCrumbs({
  nav,
  projectName,
  milestoneName,
}: {
  nav: LayerNav;
  projectName: string;
  milestoneName: string;
}) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;

  const above: Crumb[] = [];
  if (nav.depth >= 1) above.push({ label: dl.layers_portfolio, onPress: nav.home, testId: 'layers-bands-crumb-portfolio' });
  if (nav.depth === 2 && nav.projectId) {
    const projectId = nav.projectId;
    above.push({ label: projectName, onPress: () => nav.openProject(projectId), testId: 'layers-bands-crumb-project' });
  }
  const current = nav.depth === 0 ? dl.layers_portfolio : nav.depth === 1 ? projectName : milestoneName;

  return (
    <div
      className="flex items-center gap-3 min-h-[56px] px-3 py-2 border-b border-primary/10 bg-secondary/20"
      data-testid="layers-bands-crumbs"
    >
      {nav.depth > 0 && (
        <Tooltip content={dl.layers_back}>
          <Button
            variant="ghost"
            size="icon-md"
            aria-label={dl.layers_back}
            onClick={nav.back}
            data-testid="layers-bands-back"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Tooltip>
      )}
      <div className="min-w-0 flex flex-col gap-0.5">
        {above.length > 0 && (
          <KitHost>
            <Crumbs items={above} label={dl.layers_trail_aria} testId="layers-bands-trail" />
          </KitHost>
        )}
        <span className="typo-section-title truncate" data-testid="layers-bands-crumb-current" aria-current="page">
          {current}
        </span>
      </div>
    </div>
  );
}
