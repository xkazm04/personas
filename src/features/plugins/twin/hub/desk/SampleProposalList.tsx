/**
 * The queue lane's "Learned from samples" band: every open proposal a writing
 * sample produced, as cards above the framed memory (spark
 * twin-portable-blueprint). The facts the same samples yielded are pending
 * memories and are framed below as usual, labelled with their origin.
 *
 * Renders nothing while there are no open proposals. When the memory queue is
 * empty the band takes the whole column; beside a framed memory it is capped
 * so the verdict gesture below stays in view.
 */

import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import type { HubSampleProposals } from '../hubContract';
import { SampleProposalCard } from './SampleProposalCard';

export function SampleProposalList({ samples, fill }: { samples: HubSampleProposals; fill: boolean }) {
  const s = useTranslation().t.twin.samples;
  if (samples.items.length === 0) return null;

  return (
    <section
      aria-label={s.laneTitle}
      data-testid="hub-sample-proposals"
      className={`flex flex-col min-h-0 border-b border-border ${fill ? 'flex-1' : 'flex-shrink-0 max-h-[45%]'}`}
    >
      <p className="flex-shrink-0 flex items-center gap-2 px-4 md:px-8 pt-3 pb-1 typo-label text-foreground">
        <span>{s.laneTitle}</span>
        <Numeric value={samples.items.length} unit="count" className="text-primary" />
      </p>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 pb-3 pt-1 space-y-2">
        {samples.items.map((item) => (
          <SampleProposalCard
            key={item.proposal.id}
            item={item}
            busy={samples.busyId === item.proposal.id}
            error={samples.errors[item.proposal.id] ?? null}
            onResolve={(verdict, editedValue) => samples.resolve(item.proposal.id, verdict, editedValue)}
          />
        ))}
      </div>
    </section>
  );
}
