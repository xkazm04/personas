// A step's recent evidence as beads in a slot (the rail's BeadTrack), with the
// same `lc-dots-<id>` id and spoken summary the rail carried.
import { outcomeLabel } from '../../../journey/journeyLabels';
import type { JourneyNode } from '../../../journey/journeyModel';
import { useLifecycleViewModel } from '../../context';
import { BeadTrack } from '../../TactileKeys';

export function StepBeads({ node, delay = 0 }: { node: JourneyNode; delay?: number }) {
  const { dl, tx } = useLifecycleViewModel();
  if (node.dots.length === 0) return <span className="h-3" aria-hidden />;
  const summary = node.dots
    .map((d) => tx(dl.lc_dot_label, { title: d.title, outcome: outcomeLabel(dl, d.outcome) }))
    .join('; ');
  return (
    <span role="img" aria-label={summary} data-testid={`lc-dots-${node.id}`}>
      <BeadTrack beads={node.dots.map((d) => ({ key: `${d.sourceKind}:${d.sourceRef}`, outcome: d.outcome }))} delay={delay} />
    </span>
  );
}
