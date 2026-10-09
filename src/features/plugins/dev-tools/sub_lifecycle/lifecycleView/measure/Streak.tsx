// "Still running", drawn over a bar: a light streak sweeping it (the app's
// shared `animate-phase-shimmer`), or under reduced motion a static stripe.
// It fills its positioned parent and clips to its pill shape; drawn only.
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import './measure.css';

export function Streak() {
  const reduced = useReducedMotion();
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 block overflow-hidden rounded-pill" data-streak={reduced ? 'static' : 'moving'}>
      {reduced
        ? <span className="lcx-stripes absolute inset-0 block" />
        : <span className="lcx-streak animate-phase-shimmer absolute inset-y-0 left-0 block w-1/2" />}
    </span>
  );
}
