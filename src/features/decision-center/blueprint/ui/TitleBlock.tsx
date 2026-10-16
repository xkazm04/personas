import { X } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSheet } from '../controller/SheetContext';
import { Crumbs } from './Crumbs';
import { LivePill } from './header/LivePill';
import { ProjLine } from './header/ProjLine';
import { ProjectSwitcher } from './header/ProjectSwitcher';
import { LensTabs } from './LensTabs';
import { Press } from './Press';

/**
 * The header (bp Header.tsx): 58 px over a scrim that fades out by 86 px, so the plan's headings never fight it. On
 * the left the title line and the crumbs with the place's summary; on the right the project switcher, the last-scan
 * pill, the lens tabs and the way out (in bp's theme-toggle place: the sheet follows the app's theme).
 */
export function TitleBlock() {
  const s = useSheet();
  const { B } = s.text;
  return (
    <header className="bp-hd">
      <div className="bp-id">
        <ProjLine />
        <Crumbs />
      </div>
      <div className="bp-hdr-r">
        <ProjectSwitcher />
        <LivePill />
        <LensTabs />
        <Tooltip content={B.close} placement="bottom">
          <Press tone="bp-close" onClick={s.onClose} aria-label={B.close} data-testid="blueprint-close"><X aria-hidden="true" /></Press>
        </Tooltip>
      </div>
    </header>
  );
}
