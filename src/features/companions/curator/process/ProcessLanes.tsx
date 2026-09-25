import { useMemo } from 'react';
import { GitCommitVertical } from 'lucide-react';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';
import { useProcessData } from './useProcessData';
import { devLanes, extraLanes, PROTO } from './lanes';
import { ProcessGhost } from './ProcessGhost';
import { LaneKey } from './LaneParts';
import { ProcessRivers } from './ProcessRivers';
import { ProcessTransit } from './ProcessTransit';
import { ProcessInstruments } from './ProcessInstruments';

export type LanesVariant = 'rivers' | 'transit' | 'instruments';

/** The side-by-side host: every process as a lane, drawn by the chosen variant. */
export function ProcessLanes({ variant }: { variant: LanesVariant }) {
  const { t, tx } = useTranslation();
  const p = t.companions.process;
  const { reading, loading, error } = useProcessData();
  const lanes = useMemo(() => (reading ? [...devLanes(reading, p), ...extraLanes()] : []), [reading, p]);
  const View = variant === 'rivers' ? ProcessRivers : variant === 'transit' ? ProcessTransit : ProcessInstruments;

  return (
    <ContentBox data-testid="process-lanes">
      <ContentHeader
        icon={<GitCommitVertical className="h-5 w-5 text-primary" />}
        iconColor="violet"
        title={PROTO.heading}
        subtitle={reading ? tx(PROTO.subtitle, { count: lanes.length }) : undefined}
        fitWidth
        actions={<LaneKey />}
      />
      <ContentBody noPadding>
        <div className="w-full px-5 py-4">
          {!reading ? (
            error ? <p className="typo-body text-status-error">{error}</p> : loading ? <ProcessGhost /> : null
          ) : lanes.length === 0 ? (
            <p className="py-16 text-center typo-body">{p.empty}</p>
          ) : (
            <View lanes={lanes} />
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
