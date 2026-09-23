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
 */
import { channelColour, CHANNEL_ORDER } from '../model/channels';
import type { BlueprintModel } from '../model/types';
import { fmt } from '../format';
import { useWords } from '../words';

function UnlistedBand({ model }: { model: BlueprintModel }) {
  const { w, tx } = useWords();
  return (
    <div className="cb-lrow cb-band" data-role="cb-band-row">
      <div className="cb-rk" />
      <div className="cb-stg" />
      <div className="cb-sl">
        <b className="typo-title">{tx(w.band_unlisted_title, { n: fmt(model.unlisted) })}</b>
        <span
          className="typo-label cb-dim"
          data-cb-tip={tx(w.band_unlisted_tip, {
            subjects: fmt(model.subjects),
            rows: fmt(model.rows.length),
            quiet: fmt(model.quietSubjects),
            n: fmt(model.unlisted),
          })}
        >
          {w.band_unlisted_note}
        </span>
      </div>
      <div className="cb-bd" />
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
    </div>
  );
}

function QuietBand({ model }: { model: BlueprintModel }) {
  const { w, tx } = useWords();
  // EVERY declared bundle gets a chip, including one measured at zero. A
  // bundle whose tail is 0 has been looked at and found to have no quiet
  // subject; dropping it would make that measurement indistinguishable from a
  // bundle the projection never mentioned, which is the one mistake this whole
  // page exists to prevent.
  const bundles = [...model.quiet].sort((a, b) => b.subjects - a.subjects || a.domain.localeCompare(b.domain));
  return (
    <div className="cb-lrow cb-band" data-role="cb-band-row">
      <div className="cb-note" data-cb-tip={w.band_quiet_tip}>
        <div className="cb-noteline">
          <b className="typo-data-lg">{fmt(model.quietSubjects)}</b>
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
      {model.unlisted > 0 && <UnlistedBand model={model} />}
      {/* The band is drawn whenever the projection DECLARED a tail, even one
          that is zero everywhere. A tail of nothing is a measurement; an
          absent tail is not. */}
      {model.quiet.length > 0 && <QuietBand model={model} />}
    </>
  );
}
