// Passport Atlas, Instrument figure - a line's identity cell: the project tile,
// then the kicker line (discipline, folder, blockers) over the name, which is
// the door to the project's passport.
import { useContext } from 'react';
import { Button } from '@/features/shared/components/buttons';
import type { AppPassport } from '../../../passportModel';
import { blockersOf, countInk } from '../../atlasModel';
import { ATLAS_WORDS as W } from '../../atlasWords';
import { AtlasFavicons } from '../../atlasFavicons';
import type { AtlasNames } from '../../atlasFigure';
import { ProjectTile } from './InstrumentParts';
import { nameParts, worstInk } from './instrumentModel';

export function InstrumentIdentity({ p, names, onOpen }: { p: AppPassport; names: AtlasNames; onOpen: (slug: string) => void }) {
  const favicons = useContext(AtlasFavicons);
  const n = nameParts(p, names);
  const blockers = blockersOf(p).length;
  const status = p.repoUnreadable ? W.unreadableShort : blockers ? W.blockerCount(blockers) : W.noBlockersShort;
  const meta = [n.kicker, n.qualifier, status].filter(Boolean).join(' · ');
  return (
    <span role="rowheader" className="atlas-id">
      <ProjectTile title={n.title} ink={worstInk(p)} gaps={p.repoUnreadable ? '?' : countInk(p, 'bad')} favicon={favicons.get(p.identity.slug)} />
      <Button variant="ghost" size="sm" className="atlas-matrix__name" onClick={() => onOpen(p.identity.slug)} data-testid={`atlas-open-${p.identity.slug}`}>
        <span className="typo-caption k-quiet k-ellipsis max-w-full">{meta}</span>
        <span className="atlas-matrix__title typo-body k-strong">{n.title}{n.cut ? '…' : ''}</span>
      </Button>
    </span>
  );
}
