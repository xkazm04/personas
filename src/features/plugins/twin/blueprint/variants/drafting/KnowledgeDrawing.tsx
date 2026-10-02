import { useTranslation } from '@/i18n/useTranslation';
import type { TwinBlueprintModel } from '../../blueprintContract';
import { KNOWLEDGE_FULL_AT } from '../../sectionMetrics';
import KnowledgeMix from './KnowledgeMix';
import { Letter } from './Lettering';
import TallyRow from './TallyRow';
import DrawFrame from './draw/DrawFrame';
import Write, { WriteNumber } from './draw/Write';

type Knowledge = TwinBlueprintModel['knowledge'];

/**
 * Knowledge: layer one (and the stage) draws the memories as one composition
 * bar in the status roles (approved, awaiting review, rejected), then the
 * distilled facts and whether a knowledge base is bound. The zoom (L2) keeps
 * the counting signature: the bar over a tally per state, struck stroke by
 * stroke, plus the facts tally and the samples to review. Each tally, the
 * facts figure and the knowledge base are their own containers, so their
 * marks are struck side by side.
 */
export default function KnowledgeDrawing({
  knowledge,
  samplesOpen = null,
  size,
}: {
  knowledge: Knowledge;
  samplesOpen?: number | null;
  size: 'compact' | 'l1' | 'l2';
}) {
  const { t, tx } = useTranslation();
  const b = t.twin.blueprint;
  const m = b.metrics;
  const { approved, pending, rejected } = knowledge.memories;

  if (size === 'compact') return <KnowledgeMix knowledge={knowledge} />;

  const notMeasured = b.states.notMeasured;
  if (size === 'l1') {
    return (
      <div className="flex min-h-0 flex-col gap-3">
        <Letter className="twd-head-l1">{m.memories}</Letter>
        <KnowledgeMix knowledge={knowledge} />
        <div className="twd-facts-l1 flex flex-wrap items-start gap-x-8 gap-y-2 pt-1">
          <Figure label={m.facts} value={knowledge.facts} />
          <span className="flex flex-col gap-1" data-draw-scope="">
            <Letter>{m.knowledgeBase}</Letter>
            <KbMark bound={knowledge.kbBound} />
          </span>
        </div>
      </div>
    );
  }

  // L2: the memories with their composition on the left, what else it knows on the right.
  return (
    <div className="grid min-h-0 flex-1 content-start gap-x-12 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))' }}>
      <section className="flex min-w-0 max-w-xl flex-col gap-5" data-draw-scope="">
        <Letter>{m.memories}</Letter>
        <KnowledgeMix knowledge={knowledge} />
        <div className="flex flex-col gap-1">
          <TallyRow label={m.approved} count={approved} kind="approved" gates={10} large notMeasured={notMeasured} />
          <span className="typo-caption">
            <Write text={tx(b.variantCopy.drafting.fullAt, { count: KNOWLEDGE_FULL_AT })} />
          </span>
        </div>
        <TallyRow label={m.awaiting} count={pending} kind="awaiting" gates={10} large notMeasured={notMeasured} />
        <TallyRow label={m.rejected} count={rejected} kind="rejected" gates={10} large notMeasured={notMeasured} />
      </section>
      <section className="flex min-w-0 max-w-xl flex-col gap-5" data-draw-scope="">
        <Letter>{m.facts}</Letter>
        <TallyRow label={m.facts} count={knowledge.facts} kind="approved" gates={10} large notMeasured={notMeasured} />
        <span className="flex flex-col gap-1" data-draw-scope="">
          <Letter>{m.knowledgeBase}</Letter>
          <KbMark bound={knowledge.kbBound} />
        </span>
        <Figure label={m.samplesOpen} value={samplesOpen} />
      </section>
    </div>
  );
}

/** A lettered count; `null` is a dash, never a 0. */
function Figure({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="flex flex-col gap-1" data-measured={value === null ? 'false' : 'true'} data-draw-scope="">
      <Letter>{label}</Letter>
      {value === null ? (
        <span className="typo-caption">
          <Write text="-" />
        </span>
      ) : (
        <WriteNumber value={value} className="typo-data text-foreground" />
      )}
    </span>
  );
}

/**
 * The knowledge base as a bound volume: a solid book when bound, a dashed
 * outline when not. The cover is a frame; the binding (its fill and spine)
 * and the words are drawn into it.
 */
export function KbMark({ bound }: { bound: boolean }) {
  const { t } = useTranslation();
  const m = t.twin.blueprint.metrics;
  const edge = bound ? 'var(--ink-strong)' : 'var(--ink-dim)';
  return (
    <span className="flex items-center gap-2" data-kb={bound ? 'bound' : 'unbound'}>
      <span aria-hidden className="relative block h-[18px] w-[14px] shrink-0" style={{ border: '1.5px solid transparent' }}>
        <DrawFrame stroke={edge} width={1.5} edge={1.5} dash={bound ? undefined : '3 2'} />
        {bound && <span data-draw="rise" className="absolute inset-0" style={{ background: 'color-mix(in srgb, var(--ink) 40%, transparent)' }} />}
        <i data-draw="drop" className="absolute inset-y-0 left-[2px] w-[1.25px]" style={{ background: edge }} />
      </span>
      <span className="typo-body text-foreground">
        <Write text={bound ? m.kbBound : m.kbUnbound} />
      </span>
    </span>
  );
}
