/**
 * The ledger body with no rows in it - said ONCE, quietly, in the ledger's own
 * voice.
 *
 * It sits inside `.cb-lscroll`, under the real head and above the real bands,
 * on the ledger's own grid. That placement is the point: the operator meets an
 * empty ledger, not a card that replaced one. A shared `<EmptyState>` here
 * would be a foreign surface announcing that the page is missing, when what is
 * missing is the measurement.
 *
 * ## The three phases, and why they are three
 *
 * Two of them are in flight and one is not, and conflating them is how a
 * surface tells an operator "nothing here" while it is still reading:
 *
 * - `reading`  - the first read of the session has not come back yet.
 * - `running`  - the instrument is walking the corpus right now.
 * - `unrun`    - the read came back and there is no projection. Run me.
 *
 * None of the three carries a run control: the console above owns exactly one,
 * in every phase. Two buttons for one act is what the old empty state had.
 */
import { useWords } from '../words';

/** Which unpopulated phase the page is in. Only consulted when `rows` is null. */
export type BlueprintPhase = 'reading' | 'running' | 'unrun';

export function LedgerEmpty({ phase }: { phase: BlueprintPhase }) {
  const { w } = useWords();
  const say =
    phase === 'running'
      ? { title: w.console.refresh_title, body: w.console.refresh_body }
      : phase === 'reading'
        ? { title: w.boot_title, body: w.boot_body }
        : { title: w.no_plan_title, body: w.no_plan_body };

  return (
    <div className="cb-lrow cb-lempty" data-role="cb-ledger-empty" data-phase={phase}>
      <div className="cb-note">
        <div className="cb-noteline">
          {/* The mark first, then the sentence: the reader meets the page's
              own ink for "nobody looked" in the place the rows would be, and
              the words explain it rather than the other way round. */}
          <span className="cb-unkbox" aria-hidden="true" />
          <b className="typo-title" role="status">
            {say.title}
          </b>
        </div>
        <p className="typo-caption">{say.body}</p>
      </div>
    </div>
  );
}
