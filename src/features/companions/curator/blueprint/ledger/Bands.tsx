/**
 * The corpus this plan does not carry stays ON the surface, as bands that sit
 * on the same nine columns so they read against the rows above them.
 *
 * Two of them, and neither is a zero row:
 *
 * - The QUIET band is `CuratorPlan.quiet` - the subjects that score nothing on
 *   every channel that could be measured. Wanting nothing is a fact about the
 *   subject, so it is drawn, and the bundles where demand was never read wear
 *   a dotted edge because there a nothing is only a nothing on seven channels.
 * - The UNLISTED band appears only when the corpus counts subjects that
 *   neither the rows nor the quiet tail account for. For a whole projection it
 *   is absent. When it is there, every column reads UNKNOWN, because this
 *   instrument carries the count and not what they score on.
 *
 * BEFORE ANY PROJECTION both bands draw, in their unmeasured form. They are
 * the page's two statements about the corpus outside the plan, and a page that
 * hid them until a plan existed would be showing the operator a different
 * layout from the one they will get.
 */
import { channelColour, CHANNEL_ORDER } from '../model/channels';
import type { BlueprintModel } from '../model/types';
import { fmt } from '../format';
import { useWords } from '../words';

import { Unmeasured } from './Unmeasured';

function UnknownColumns() {
  return (
    <>
      {CHANNEL_ORDER.map((id) => (
        <div
          key={id}
          className={`cb-cell${id >= 7 ? ' cb-wide' : ''}`}
          style={{ ['--cb-cc']: channelColour(id) } as React.CSSProperties}
        >
          <span className="cb-unkbox" />
        </div>
      ))}
      <div className="cb-vrule" />
      <div className="cb-tot">
        <span className="cb-tn typo-data cb-z">{'?'}</span>
      </div>
    </>
  );
}

function UnlistedBand({ model }: { model: BlueprintModel }) {
  const { w, tx } = useWords();
  const unmeasured = model.unlisted === null;
  return (
    <div className="cb-lrow cb-band" data-role="cb-band-row">
      <div className="cb-rk" />
      <div className="cb-stg" />
      <div className="cb-sl">
        {unmeasured ? (
          <>
            <b className="typo-title">{w.band_unlisted_unmeasured}</b>
            <span className="typo-label cb-dim" data-cb-tip={w.band_unlisted_unmeasured_tip}>
              {w.band_unlisted_unmeasured_note}
            </span>
          </>
        ) : (
          <>
            <b className="typo-title">{tx(w.band_unlisted_title, { n: fmt(model.unlisted) })}</b>
            <span
              className="typo-label cb-dim"
              data-cb-tip={tx(w.band_unlisted_tip, {
                subjects: fmt(model.subjects),
                rows: fmt(model.rows?.length),
                quiet: fmt(model.quietSubjects),
                n: fmt(model.unlisted),
              })}
            >
              {w.band_unlisted_note}
            </span>
          </>
        )}
      </div>
      <div className="cb-bd" />
      <UnknownColumns />
    </div>
  );
}

function QuietBand({ model }: { model: BlueprintModel }) {
  const { w, tx } = useWords();
  // EVERY declared bundle gets a chip, including one measured at zero. A
  // bundle whose tail is 0 has been looked at and found to have no quiet
  // subject; dropping it would make that measurement indistinguishable from a
  // bundle the projection never mentioned, which is the one mistake this whole
  // page exists to prevent. With no projection there are no bundles to chip -
  // the tally reads unknown and the row carries no chips at all.
  const bundles = [...(model.quiet ?? [])].sort(
    (a, b) => b.subjects - a.subjects || a.domain.localeCompare(b.domain),
  );
  const unmeasured = model.quietSubjects === null;
  return (
    <div className="cb-lrow cb-band" data-role="cb-band-row">
      <div className="cb-note" data-cb-tip={unmeasured ? w.band_quiet_unmeasured_tip : w.band_quiet_tip}>
        <div className="cb-noteline">
          {unmeasured ? (
            <Unmeasured size="lg" tip={w.band_quiet_unmeasured_tip} />
          ) : (
            <b className="typo-data-lg">{fmt(model.quietSubjects)}</b>
          )}
          <b className="typo-title">{w.band_quiet_title}</b>
          <div className="cb-chips">
            {bundles.map((q) => (
              <span
                key={q.domain}
                className="typo-label cb-chip"
                style={{
                  borderColor: 'var(--cb-rule-2)',
                  borderStyle: q.demandKnown ? undefined : 'dotted',
                }}
                data-cb-tip={
                  q.subjects === 0
                    ? tx(w.quiet_bundle_tip_none, { domain: q.domain })
                    : tx(q.demandKnown ? w.quiet_bundle_tip : w.quiet_bundle_tip_unknown, {
                        domain: q.domain,
                        n: q.subjects,
                      })
                }
              >
                {`${model.bundleMark[q.domain] ?? q.domain} ${String(q.subjects)}`}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Bands({ model }: { model: BlueprintModel }) {
  return (
    <>
      {/* Unknown and above-zero are the two reasons to draw it; a measured
          zero is the one case where there is genuinely nothing to say. */}
      {(model.unlisted === null || model.unlisted > 0) && <UnlistedBand model={model} />}
      {/* The band is drawn whenever the projection DECLARED a tail, even one
          that is zero everywhere. A tail of nothing is a measurement; an
          absent tail is not - and an UNREAD tail is a third thing again, which
          is why a null quiet list draws the band rather than hiding it. */}
      {(model.quiet === null || model.quiet.length > 0) && <QuietBand model={model} />}
    </>
  );
}
