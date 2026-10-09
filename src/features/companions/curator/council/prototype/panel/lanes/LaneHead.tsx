// PROTOTYPE ROUND (spark council-readout), direction D. A lane's head: the
// project and how many councils it holds, and on the same columns as its
// rows the lane's own MEAN per member (over the councils that measured it)
// and its mean overall - the strip that answers "where is this project
// weakest" before a single row is read.
import { interpolate as tx, useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import { HeatCell } from './HeatCell';
import { memberName, overallTone, type Lane } from './laneModel';

const S = {
  mean: 'Lane mean of {member}: {score}, over {n} of {read} councils',
  meanUnmeasured: 'No council in this lane measured {member}',
  overallMean: 'Lane mean overall {score}',
};

export function LaneHead({ lane, members, headId }: { lane: Lane; members: string[]; headId: string }) {
  const { language } = useTranslation();
  const num = (v: number) => formatCount(v, { precision: 2, language });
  const overalls = lane.rows.flatMap((r) => (r.subject.overall == null ? [] : [r.subject.overall]));
  const meanOverall = overalls.length > 0 ? overalls.reduce((a, b) => a + b, 0) / overalls.length : null;
  const threshold = lane.rows[0]?.rubric.threshold ?? 0.7;
  const anyRead = lane.rows.some((r) => r.seats != null);
  const labels = members.map((m) => {
    const mean = lane.means[m];
    if (!mean || mean.score == null) return tx(S.meanUnmeasured, { member: memberName(m) });
    return tx(S.mean, { member: memberName(m), score: num(mean.score), n: mean.measured, read: mean.read });
  });

  return (
    <div className="ln-lanehead">
      <h3 id={headId} className="ln-project">
        <span className="typo-title-lg">{lane.project}</span>
        <span className="ln-project__n typo-heading font-data">{lane.rows.length}</span>
      </h3>
      <span className="sr-only">{labels.join('. ')}</span>
      {members.map((m) => {
        const mean = lane.means[m];
        const kind = !anyRead ? 'ghost' : mean?.score == null ? 'unmeasured' : 'score';
        return <HeatCell key={m} kind={kind} score={mean?.score ?? null} lane />;
      })}
      {meanOverall == null ? (
        <span />
      ) : (
        <b
          className={`ln-overall ln-overall--lane typo-body font-data is-${overallTone(meanOverall, threshold)}`}
          aria-label={tx(S.overallMean, { score: num(meanOverall) })}
        >
          {num(meanOverall)}
        </b>
      )}
    </div>
  );
}

export default LaneHead;
