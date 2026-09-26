/**
 * THE GAPS - the third drawer, and the operator's own word for what it holds.
 *
 * It exists because they saw the evidence before the app did: "fleets of stale
 * operations related to curator leading into signals we have gaps in the
 * process". Every fact behind those words was already measurable and none of it
 * was drawn anywhere, so the only way to learn any of it was to open her
 * database.
 *
 * Same box, same head, same open/close grammar and the same inks as the docket
 * and the queue - it wears their `cb-drawer` / `cb-dk-head` classes rather than a
 * third copy of them, and `useBlueprintState` keeps ONE drawer slot, so opening
 * this one shuts whichever was open.
 *
 * THREE BANDS, IN THE ORDER THE QUESTION IS ASKED:
 *
 * 1. **Is it worth anything?** Growth first, because it is the only band that
 *    can say the running is achieving nothing - and because every other figure
 *    she keeps is a rate that rises whether it is or not.
 * 2. **What is in the way?** Her plan's undispatchable engines, split by whose
 *    fix it is. This is where `holds` and `frees` being two numbers earns its
 *    keep: a row that holds 99 and frees 0 must not look like the best fix here.
 * 3. **What went quiet?** The runs that stopped reporting, with the fleet's own
 *    sentence carried verbatim.
 *
 * And a foot naming **what actually stops her**, because a reader deciding
 * whether to leave her running needs the terminating condition. With no ceiling
 * declared the honest answer is the subscription's usage limit, and the foot says
 * that rather than implying a budget nobody set.
 */
import Button from '@/features/shared/components/buttons/Button';

import { GrowthBand } from './gaps/GrowthBand';
import { ImpedimentRow } from './gaps/ImpedimentRow';
import { QuietRow } from './gaps/QuietRow';
import type { GapsReading } from './gaps/useGaps';
import { useWords } from './words';

/** How many quiet runs the drawer draws before it says how many more there are. */
const QUIET_SHOWN = 12;

export interface GapsDrawerProps {
  open: boolean;
  onClose: () => void;
  reading: GapsReading;
}

export function GapsDrawer({ open, onClose, reading }: GapsDrawerProps) {
  const { w, tx } = useWords();
  const g = w.gaps;
  const { impediments, growth, attrition } = reading;
  const quiet = attrition?.runs ?? [];

  return (
    <section
      className={`cb-drawer cb-gaps${open ? ' cb-open' : ''}`}
      data-role="cb-gaps"
      aria-label={g.region}
      aria-hidden={!open}
    >
      <div className="cb-dk-head" data-role="cb-gaps-head">
        <h2 className="typo-section-title">{g.title}</h2>
        <span className="cb-sp" />
        <Button
          variant="ghost"
          size="sm"
          className="cb-keep cb-tbtn typo-caption"
          data-role="cb-gaps-close"
          onClick={onClose}
        >
          <kbd>Esc</kbd>
          {w.docket_close}
        </Button>
      </div>

      <div className="cb-gap-body">
        <section className="cb-gap-band" data-role="cb-gaps-band-growth">
          <h3 className="typo-eyebrow">{g.growth_title}</h3>
          <GrowthBand growth={growth} />
        </section>

        <section className="cb-gap-band" data-role="cb-gaps-band-blocked">
          <h3 className="typo-eyebrow">{g.blocked_title}</h3>
          {impediments === null ? (
            <p className="cb-gap-unread typo-body" data-cb-tip={g.unread_tip}>
              {g.unread}
            </p>
          ) : impediments.length === 0 ? (
            /* A real and good state, and distinguishable from an unread door:
               nothing in her plan is undispatchable. */
            <p className="cb-gap-none typo-body" data-role="cb-gaps-blocked-none">
              {g.blocked_none}
            </p>
          ) : (
            <ul className="cb-gap-rows">
              {impediments.map((item) => (
                <ImpedimentRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>

        <section className="cb-gap-band" data-role="cb-gaps-band-quiet">
          <h3 className="typo-eyebrow">{g.quiet_title}</h3>
          {attrition === null ? (
            <p className="cb-gap-unread typo-body" data-cb-tip={g.unread_tip}>
              {g.unread}
            </p>
          ) : (
            <>
              {quiet.length === 0 ? (
                <p className="cb-gap-none typo-body" data-role="cb-gaps-quiet-none">
                  {g.quiet_none}
                </p>
              ) : (
                <ul className="cb-gap-rows">
                  {quiet.slice(0, QUIET_SHOWN).map((run) => (
                    <QuietRow key={run.sessionId} run={run} />
                  ))}
                </ul>
              )}
              {quiet.length > QUIET_SHOWN && (
                <p className="cb-gap-none typo-caption" data-role="cb-gaps-quiet-more">
                  {tx(g.quiet_more, { n: quiet.length - QUIET_SHOWN })}
                </p>
              )}
              {/* What it cost, and the rule that caused it. The threshold comes
                  from the fleet's own constant, so this line cannot quote a
                  number the fleet has since changed. */}
              <p className="cb-gap-cost typo-caption" data-role="cb-gaps-cost">
                <span data-cb-tip={g.written_off_tip}>
                  {tx(g.written_off, { n: attrition.writtenOff })}
                </span>
                {attrition.abandoned > 0 && (
                  <span data-role="cb-gaps-abandoned" data-cb-tip={g.abandoned_tip}>
                    {tx(g.abandoned, { n: attrition.abandoned })}
                  </span>
                )}
                <span data-cb-tip={g.quiet_threshold_tip}>
                  {tx(g.quiet_threshold, { n: Math.round(attrition.staleAfterSecs / 60) })}
                </span>
              </p>
            </>
          )}
        </section>

        {/* WHAT STOPS HER. The operator has declared no daily ceiling on
            purpose - the run is meant to continue until the subscription's own
            usage limit ends it - so this says that instead of drawing three
            gauges against caps nobody set, which would read as a budget. */}
        <p className="cb-gap-foot typo-caption" data-role="cb-gaps-stops" data-cb-tip={g.stops_tip}>
          {g.stops}
        </p>
      </div>
    </section>
  );
}
