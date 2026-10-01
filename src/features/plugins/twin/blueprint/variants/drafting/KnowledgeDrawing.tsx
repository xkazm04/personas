import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { TwinBlueprintModel } from '../../blueprintContract';
import { KNOWLEDGE_FULL_AT } from '../../sectionMetrics';
import KnowledgeMix from './KnowledgeMix';
import { Letter } from './Lettering';
import TallyRow from './TallyRow';

type Knowledge = TwinBlueprintModel['knowledge'];

/**
 * Knowledge as a tally: approved memories in ink, those awaiting review in
 * pencil, rejected ones crossed out, then the distilled facts and whether a
 * knowledge base is bound. Stage mode draws the same three counts as one
 * composition bar, so the column beside the card stays short; the zoom (L2)
 * runs the tallies longer and adds the facts tally and the samples to review.
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
        <TallyRow label={m.approved} count={approved} kind="approved" gates={6} notMeasured={notMeasured} />
        <TallyRow label={m.awaiting} count={pending} kind="awaiting" gates={6} notMeasured={notMeasured} />
        <TallyRow label={m.rejected} count={rejected} kind="rejected" gates={6} notMeasured={notMeasured} />
        <div className="twd-facts-l1 flex flex-wrap items-start gap-x-8 gap-y-2 pt-1">
          <Figure label={m.facts} value={knowledge.facts} />
          <span className="flex flex-col gap-1">
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
      <section className="flex min-w-0 max-w-xl flex-col gap-5">
        <Letter>{m.memories}</Letter>
        <KnowledgeMix knowledge={knowledge} />
        <div className="flex flex-col gap-1">
          <TallyRow label={m.approved} count={approved} kind="approved" gates={10} large notMeasured={notMeasured} />
          <span className="typo-caption">{tx(b.variantCopy.drafting.fullAt, { count: KNOWLEDGE_FULL_AT })}</span>
        </div>
        <TallyRow label={m.awaiting} count={pending} kind="awaiting" gates={10} large notMeasured={notMeasured} />
        <TallyRow label={m.rejected} count={rejected} kind="rejected" gates={10} large notMeasured={notMeasured} />
      </section>
      <section className="flex min-w-0 max-w-xl flex-col gap-5">
        <Letter>{m.facts}</Letter>
        <TallyRow label={m.facts} count={knowledge.facts} kind="approved" gates={10} large notMeasured={notMeasured} />
        <span className="flex flex-col gap-1">
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
    <span className="flex flex-col gap-1" data-measured={value === null ? 'false' : 'true'}>
      <Letter>{label}</Letter>
      {value === null ? <span className="typo-caption">-</span> : <Numeric value={value} className="typo-data text-foreground" />}
    </span>
  );
}

/** The knowledge base as a bound volume: a solid book when bound, a dashed outline when not. */
export function KbMark({ bound }: { bound: boolean }) {
  const { t } = useTranslation();
  const m = t.twin.blueprint.metrics;
  return (
    <span className="flex items-center gap-2" data-kb={bound ? 'bound' : 'unbound'}>
      <svg aria-hidden width={18} height={20} className="shrink-0 overflow-visible">
        <rect
          x={2}
          y={1}
          width={14}
          height={18}
          fill={bound ? 'color-mix(in srgb, var(--ink) 40%, transparent)' : 'none'}
          stroke={bound ? 'var(--ink-strong)' : 'var(--ink-dim)'}
          strokeWidth={1.5}
          strokeDasharray={bound ? undefined : '3 2'}
        />
        <line x1={5.5} y1={1} x2={5.5} y2={19} stroke={bound ? 'var(--ink-strong)' : 'var(--ink-dim)'} strokeWidth={1.25} />
      </svg>
      <span className="typo-body text-foreground">{bound ? m.kbBound : m.kbUnbound}</span>
    </span>
  );
}
