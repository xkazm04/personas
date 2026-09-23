// originLabel — who asked for a session, as a word.
//
// Its own module because both the queue tile and the shared node read it,
// and the node must not import the tile it is rendered by.

import type { DispatchOrigin } from '@/lib/bindings/DispatchOrigin';
import type { useTranslation } from '@/i18n/useTranslation';

type Monitor = ReturnType<typeof useTranslation>['t']['monitor'];

export function originLabel(s: Monitor, origin: DispatchOrigin): string {
  switch (origin) {
    case 'dev_runner': return s.queue_origin_dev_runner;
    case 'dispatch_ideas': return s.queue_origin_dispatch_ideas;
    case 'athena': return s.queue_origin_athena;
    case 'autopilot': return s.queue_origin_autopilot;
    case 'night_shift': return s.queue_origin_night_shift;
    case 'feed_impact': return s.queue_origin_feed_impact;
    case 'orphan_resume': return s.queue_origin_orphan_resume;
    case 'remote': return s.queue_origin_remote;
    default: return s.queue_origin_manual;
  }
}
