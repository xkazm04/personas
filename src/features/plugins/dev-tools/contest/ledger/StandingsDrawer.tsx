// Standings: what each decided contest gave the owner (its winning still, the
// seat that built it, its round) and how far each seat's record can be
// trusted: a record matrix over the last decided contests, and each seat's
// win rate with its 95% Wilson interval (stats.ts), so 1 win of 1 does not
// outrank 6 of 10.
import { useMemo } from 'react';
import { Trophy, X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { BaseModal } from '@/lib/ui/BaseModal';
import { formatPercent } from '@/lib/utils/formatters';

import { MIN_RANKABLE_SAMPLE, seatWinRates } from '../stats';
import { keyOf, variantName } from './ledgerModel';
import { cssVars, drawerPanelClass, formatDay, Kbd, Seat, Still } from './parts';

const TITLE_ID = 'ledger-standings-title';
/** Matrix columns: the last dozen decided contests. */
const MATRIX_COLS = 12;

export interface StandingsDrawerProps {
  contests: ContestSummary[];
  wide: boolean;
  onPick: (key: string) => void;
  onClose: () => void;
}

export function StandingsDrawer({ contests, wide, onPick, onClose }: StandingsDrawerProps) {
  const { t, tx, language } = useTranslation();
  const s = t.plugins.contest;
  const L = s.ledger;
  const decided = useMemo(() => contests.filter((c) => c.phase === 'decided').sort((a, b) => a.date.localeCompare(b.date)), [contests]);
  const podiums = useMemo(() => decided.filter((c) => c.winner).slice().reverse(), [decided]);
  const board = useMemo(() => seatWinRates(contests), [contests]);
  const cols = decided.slice(-MATRIX_COLS);

  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} placement="right-drawer" portal panelClassName={drawerPanelClass(wide)}>
      <div className={`contest-ledger sl-drawer${wide ? ' wide' : ''}`} data-type-density="compact" data-testid="ledger-standings">
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
          <section aria-label={L.podium_history}>
            <div className="sect-h">
              {L.podium_history}
              <span className="n">{podiums.length}</span>
              <span className="r">{L.newest_first}</span>
            </div>
            {podiums.length === 0 ? (
              <div className="hint">{L.podium_empty}</div>
            ) : (
              podiums.map((p) => {
                const v = p.ledger.variants.find((x) => x.key === p.winner) ?? null;
                return (
                  <div
                    key={keyOf(p)}
                    className="pod"
                    role="button"
                    tabIndex={0}
                    onClick={() => onPick(keyOf(p))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onPick(keyOf(p));
                      }
                    }}
                    data-testid={`ledger-podium-${p.contestId}`}
                  >
                    <span className="thumb">
                      <Still src={v?.still ?? null} label="" />
                    </span>
                    <div className="min-w-0">
                      <div className="p1">{p.title}</div>
                      <div className="p2">
                        <Trophy className="w-3.5 h-3.5 shrink-0 text-status-success" aria-hidden />
                        <b>{p.winner}</b>
                        {v && variantName(v)}
                        {p.winnerSeatSpec && (
                          <>
                            <span className="sep">·</span>
                            <Seat spec={p.winnerSeatSpec} quiet />
                          </>
                        )}
                      </div>
                    </div>
                    <div className="p3">
                      {p.round ? tx(L.round_n, { n: p.round }) : L.first_round}
                      <br />
                      {formatDay(p.date, language)}
                    </div>
                  </div>
                );
              })
            )}
          </section>
          <section aria-label={L.record_title}>
            <div className="sect-h">
              {L.record_title}
              <span className="n">{tx(L.record_decided, { count: board.decided })}</span>
              <span className="r">
                <Tooltip content={board.separated ? s.stats_separated_hint : s.stats_not_separated_hint}>
                  <span className="chip" style={cssVars({ '--c': board.separated ? 'var(--status-success)' : 'var(--status-warning)' })}>
                    {board.separated ? s.stats_separated : s.stats_not_separated}
                  </span>
                </Tooltip>
              </span>
            </div>
            {board.rows.length === 0 ? (
              <div className="hint">{s.stats_empty}</div>
            ) : (
              <table className="matrix" data-testid="ledger-matrix">
                <thead>
                  <tr>
                    <th className="l">{s.col_spec}</th>
                    {cols.map((c, i) => (
                      <th key={keyOf(c)}>
                        <Tooltip content={c.title}>
                          <span>{i + 1}</span>
                        </Tooltip>
                      </th>
                    ))}
                    <th>{s.col_entered}</th>
                    <th>{s.col_wins}</th>
                    <th className="l">{s.col_interval}</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((r) => {
                    const rate = r.entered ? r.wins / r.entered : 0;
                    return (
                      <tr key={r.spec}>
                        <td className="l">
                          <Seat spec={r.spec} />
                        </td>
                        {cols.map((c) => {
                          const entered = c.seatSpecs.includes(r.spec);
                          const won = c.winnerSeatSpec === r.spec;
                          return (
                            <td key={keyOf(c)}>
                              {entered && (
                                <Tooltip content={tx(won ? L.matrix_won : L.matrix_entered, { title: c.title })}>
                                  <span className={won ? 'won' : 'ent'}>{won ? '●' : '○'}</span>
                                </Tooltip>
                              )}
                            </td>
                          );
                        })}
                        <td>{r.entered}</td>
                        <td>{r.wins}</td>
                        <td className="l">
                          <span className="inline-flex items-center gap-2">
                            <span className="wbar" role="img" aria-label={tx(s.stats_interval_aria, { low: formatPercent(r.low, { fromRatio: true, precision: 0 }), high: formatPercent(r.high, { fromRatio: true, precision: 0 }) })}>
                              <i className="ax" />
                              <i className="iv" style={{ left: `${(r.low * 100).toFixed(1)}%`, width: `${((r.high - r.low) * 100).toFixed(1)}%` }} />
                              <i className="pt" style={{ left: `${(rate * 100).toFixed(1)}%` }} />
                            </span>
                            <span className="mu tab">
                              {formatPercent(r.low, { fromRatio: true, precision: 0 })}–{formatPercent(r.high, { fromRatio: true, precision: 0 })}
                            </span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="mlegend">
              {cols.map((c, i) => (
                <span key={keyOf(c)}>
                  <b>{i + 1}</b>
                  {c.title}
                </span>
              ))}
              {decided.length > cols.length && <span className="mu">{tx(L.matrix_showing, { shown: cols.length, total: decided.length })}</span>}
            </div>
            <div className="hint" style={{ marginTop: 10 }}>
              {board.separated ? s.stats_separated_hint : s.stats_not_separated_hint}
              {board.decided < MIN_RANKABLE_SAMPLE && ` ${tx(s.stats_small_sample, { n: MIN_RANKABLE_SAMPLE })}`} {L.matrix_key}
            </div>
          </section>
        </div>
      </div>
    </BaseModal>
  );
}
