// Standings: a quick overview of what the contests have been about and who
// wins them. Totals up top, then every model's record (entered / won) and every
// task area's contest count with its most successful model. The 95% Wilson
// caveat (stats.ts) stays as one line underneath, so a rate is never read as a
// verdict on a handful of contests.
import { useMemo } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { BaseModal } from '@/lib/ui/BaseModal';
import { formatPercent } from '@/lib/utils/formatters';

import { MIN_RANKABLE_SAMPLE, seatWinRates } from '../stats';
import { drawerPanelClass, Kbd } from './parts';
import { standingsOverview } from './standingsOverview';

const TITLE_ID = 'ledger-standings-title';

export interface StandingsDrawerProps {
  contests: ContestSummary[];
  wide: boolean;
  onClose: () => void;
}

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="ov-tile">
      <div className="ov-tile-v tab">{value}</div>
      <div className="ov-tile-l">{label}</div>
      {sub && <div className="ov-tile-s tab">{sub}</div>}
    </div>
  );
}

export function StandingsDrawer({ contests, wide, onClose }: StandingsDrawerProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const L = s.ledger;
  const overview = useMemo(() => standingsOverview(contests), [contests]);
  const board = useMemo(() => seatWinRates(contests), [contests]);
  const topModel = overview.models.find((m) => m.wins > 0) ?? null;
  const pct = (ratio: number) => formatPercent(ratio, { fromRatio: true, precision: 0 });

  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} placement="right-drawer" portal panelClassName={drawerPanelClass(wide)}>
      <div className={`contest-ledger sl-drawer${wide ? ' wide' : ''}`} data-testid="ledger-standings">
        <div className="dr-h">
          <div className="hx">
            <h2 id={TITLE_ID}>{L.standings}</h2>
            <p>{L.standings_hint}</p>
          </div>
          <Kbd>Esc</Kbd>
          <Button variant="secondary" size="icon-sm" aria-label={L.standings_close} onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="dr-body stand">
          {overview.decided === 0 ? (
            <div className="hint">{s.stats_empty}</div>
          ) : (
            <>
              <div className="ov-tiles" data-testid="ledger-overview">
                <Tile label={L.tile_contests} value={overview.contests} />
                <Tile label={L.tile_decided} value={overview.decided} />
                <Tile label={L.tile_models} value={overview.models.length} />
                <Tile label={L.tile_top} value={topModel?.model ?? '-'} sub={topModel ? `${topModel.wins}/${topModel.entered}` : undefined} />
              </div>
              <section aria-label={L.by_model}>
                <div className="sect-h">
                  {L.by_model}
                  <span className="n">{tx(L.record_decided, { count: overview.decided })}</span>
                </div>
                <div className="ov-rows">
                  {overview.models.map((m) => {
                    const rate = m.entered ? m.wins / m.entered : 0;
                    return (
                      <div key={m.model} className="ov-row" data-testid={`ledger-model-${m.model}`}>
                        <span className="ov-name">{m.model}</span>
                        <span className="ov-bar" role="img" aria-label={pct(rate)}>
                          <i style={{ width: `${(rate * 100).toFixed(1)}%` }} />
                        </span>
                        <span className="ov-n tab">{m.wins}/{m.entered}</span>
                        <span className="ov-n tab">{pct(rate)}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section aria-label={L.by_area}>
                <div className="sect-h">
                  {L.by_area}
                  <span className="n">{overview.areas.length}</span>
                </div>
                <div className="ov-rows">
                  {overview.areas.map((a) => (
                    <div key={a.project} className="ov-row ov-area">
                      <span className="ov-name">{a.project}</span>
                      <span className="ov-n tab">{a.decided}/{a.contests}</span>
                      <span className="ov-top">{a.topModel ?? '-'}</span>
                    </div>
                  ))}
                </div>
              </section>
              <div className="hint">
                {board.separated ? s.stats_separated_hint : s.stats_not_separated_hint}
                {board.decided < MIN_RANKABLE_SAMPLE && ` ${tx(s.stats_small_sample, { n: MIN_RANKABLE_SAMPLE })}`}
              </div>
            </>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
