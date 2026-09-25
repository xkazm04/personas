/**
 * One intake, at forty-at-a-time density.
 *
 * TWO AXES, TWO PLACES. Where the REQUEST stands is the Mark on the spine - six
 * states, one Tone x Glyph each. What is KNOWN ABOUT THE RESOURCE is the Fact in
 * the meta line - four inks. They are independent: a landed request whose page
 * could never be read is a real row, and a surface that fused them could not
 * draw it.
 *
 * BEFORE THE PRE-READ PASS HAS RUN, the row is the link he pasted, set in
 * `typo-code` and elided from the left so the tail of a path survives. That is a
 * designed state, not a shimmer: the row is complete, it is identified, it is
 * ordered, and it says in words that nobody has read it yet. A ghost would claim
 * the row is still arriving; it is not - it is filed.
 */
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { KitButton, ListRow, Meta } from '@/features/shared/components/kit';
import type { Glyph, Tone } from '@/features/shared/components/kit';

import { useWords } from '../../../words';
import { Fact } from './Ink';
import type { Intake, RequestState } from './types';

const STATE_MARK: Record<RequestState, { tone: Tone; glyph: Glyph }> = {
  queued: { tone: 'human', glyph: 'hollow' },
  dispatched: { tone: 'primary', glyph: 'live' },
  landed: { tone: 'success', glyph: 'solid' },
  declined: { tone: 'neutral', glyph: 'soft' },
  failed: { tone: 'error', glyph: 'solid' },
  cancelled: { tone: 'neutral', glyph: 'empty' },
};

/** The link as a name: protocol dropped, the rest kept whole for the CSS to elide. */
function linkLabel(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

export function IntakeRow({ intake, onCancel, onReread }: {
  intake: Intake;
  onCancel: (id: string) => void;
  onReread: (id: string) => void;
}) {
  const { w } = useWords();
  const mark = STATE_MARK[intake.state];
  const read = intake.read;
  const stateWord = w.console.request_state[intake.state];

  const name = read.kind === 'read'
    ? <span className="typo-body k-strong k-ellipsis">{read.topic}</span>
    : <span className="typo-code k-ellipsis cb-link">{linkLabel(intake.url)}</span>;

  const fact = read.kind === 'read'
    // i18n: the bundle a read resource points at.
    ? <Fact kind="count" tip={`Read: this points at ${read.domain}.`}>{read.domain}</Fact>
    : read.kind === 'nothing'
      // i18n: measured zero - the pass fetched a document and found no topic in it.
      ? <Fact kind="measured-zero" tip="The pass read this resource and there was no topic in it. Measured, not missing.">read, no topic in it</Fact>
      : read.kind === 'unread'
        ? (
          <Fact
            kind="unknown"
            // i18n: unknown - nobody has looked. Never a zero, never a count.
            tip={read.why === 'capped'
              ? 'The pre-read pass stopped at its daily cap before reaching this one. Its topic and its bundle are UNKNOWN, not absent.'
              : 'The pre-read pass has not reached this one yet. Its topic and its bundle are UNKNOWN.'}
          >
            {read.why === 'capped' ? 'not read: the pass hit its cap' : 'not read yet'}
          </Fact>
        )
        // i18n: unmeasurable - it ran and had nothing to work from.
        : <Fact kind="unmeasurable" tip={`The pass ran and had nothing to read: ${read.why}. This is unmeasurable, not empty.`}>could not be read</Fact>;

  return (
    <ListRow
      size="s"
      state={intake.state === 'dispatched' ? 'live' : intake.state === 'cancelled' ? 'muted' : undefined}
      mark={{ ...mark, label: stateWord }}
      name={name}
      nameClass="k-ellipsis"
      meta={<Meta parts={[<span key="s" className="typo-label k-tint">{intake.skill}</span>, fact, intake.say]} />}
      figures={
        <>
          {read.kind === 'unreadable' && (
            // i18n: re-run the pre-read pass over this one resource.
            <KitButton quiet onClick={() => { onReread(intake.id); }}>re-read</KitButton>
          )}
          {intake.state === 'queued' && (
            <KitButton
              quiet
              onClick={() => { onCancel(intake.id); }}
              testId="curator-request-cancel"
              className="cb-onhover"
            >
              {w.console.request_cancel}
            </KitButton>
          )}
        </>
      }
      time={<RelativeTime timestamp={intake.filedAt} format="elapsed" className="typo-data k-quiet" />}
    />
  );
}

export { STATE_MARK };
