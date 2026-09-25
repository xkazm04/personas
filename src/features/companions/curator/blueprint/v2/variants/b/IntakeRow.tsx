/**
 * One row of the operator's lane, designed for the state it spends most of its
 * life in: RAW.
 *
 * He files forty links at a sitting. The cheap pre-processing pass the brief
 * describes (a small model reading each resource once for a topic name and a
 * high-level domain) has not run on any of them yet, and that is not a loading
 * shimmer - it is a fact with a shape. So a raw row draws the URL he pasted,
 * in code type, and says in the UNKNOWN ink that nobody has read it. Forty of
 * those stack their dashed pills into one visible column, which is how he sees
 * at a glance how much of the sitting is still unread.
 *
 * An enriched row promotes the topic to the reading line and demotes the URL,
 * because once a resource has a name the URL is provenance rather than the
 * subject. A row the pass READ AND COULD NOT NAME is a third thing again, in
 * the unmeasurable ink, with the reason it failed kept verbatim.
 */
import { ListRow, Meta } from '@/features/shared/components/kit';
import type { Glyph, Tone } from '@/features/shared/components/kit';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

import type { CuratorRequestState } from '@/lib/bindings/CuratorRequestState';
import { useWords } from '../../../words';
import { Fact } from './facts';
import { EN } from './strings';
import type { Intake } from './fixture';

const MARK: Record<CuratorRequestState, { tone: Tone; glyph: Glyph }> = {
  queued: { tone: 'human', glyph: 'hollow' },
  dispatched: { tone: 'primary', glyph: 'live' },
  landed: { tone: 'success', glyph: 'solid' },
  declined: { tone: 'neutral', glyph: 'hollow' },
  failed: { tone: 'error', glyph: 'solid' },
  cancelled: { tone: 'neutral', glyph: 'empty' },
};

/** The URL as he pasted it, minus the protocol nobody reads. */
export function bareUrl(argument: string): string {
  return argument.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function IntakeRow({ intake, muted }: { intake: Intake; muted?: boolean }) {
  const { w } = useWords();
  const { request, enrichment } = intake;
  const mark = MARK[request.state];
  const stateWord = w.console.request_state[request.state];
  const target = request.argument;
  const read = enrichment.kind === 'read';

  const skill = (
    <span key="skill" className="v2b-q__skill typo-label k-regular">
      {request.skill}
    </span>
  );

  // The second line: who runs it, then WHAT THE PRE-PASS FOUND, then where it
  // came from. The middle part is the one that changes shape with the fact.
  const found =
    enrichment.kind === 'read' ? (
      <span key="found" className="v2b-q__domain typo-caption k-ellipsis">
        {enrichment.domain}
      </span>
    ) : enrichment.kind === 'unread' ? (
      <Fact key="found" kind="unknown" label={w.legend_unknown_tip}>
        {EN.notReadYet}
      </Fact>
    ) : (
      <Fact key="found" kind="unmeasurable" label={enrichment.why}>
        {EN.nothingToName}
      </Fact>
    );

  const provenance =
    target === null ? (
      <Fact key="bare" kind="none" label={w.console.request_bare_tip}>
        {w.console.request_bare}
      </Fact>
    ) : read ? (
      <span key="url" className="typo-code k-quiet k-ellipsis">
        {bareUrl(target)}
      </span>
    ) : null;

  return (
    <ListRow
      size="line"
      state={muted ? 'muted' : undefined}
      mark={{ tone: mark.tone, glyph: mark.glyph, label: stateWord }}
      nameClass={read ? 'typo-body k-strong' : 'typo-code k-regular'}
      name={read ? enrichment.topic : target === null ? request.skill : bareUrl(target)}
      meta={<Meta parts={[skill, found, provenance]} />}
      time={<RelativeTime timestamp={request.createdAt} format="elapsed" showTooltip={false} />}
      figures={
        request.state === 'queued' ? undefined : (
          <span className="typo-label k-regular k-quiet k-nowrap">{stateWord}</span>
        )
      }
    />
  );
}

/** What a search box should match against - everything the row can show. */
export function haystack(intake: Intake): string {
  const { request, enrichment } = intake;
  const extra = enrichment.kind === 'read' ? `${enrichment.topic} ${enrichment.domain}` : '';
  return `${request.skill} ${request.argument ?? ''} ${extra}`.toLowerCase();
}
