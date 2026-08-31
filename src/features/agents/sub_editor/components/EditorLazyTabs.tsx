import { lazy } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';

export const ActivityTab = lazy(() =>
  import('@/features/agents/sub_activity/ActivityTab').then((m) => ({ default: m.ActivityTab })),
);
export const PersonaSettingsTab = lazy(() =>
  import('@/features/agents/sub_settings').then((m) => ({ default: m.PersonaSettingsTab })),
);
export const LabTab = lazy(() =>
  import('@/features/agents/sub_lab/components/shared/LabTab').then((m) => ({ default: m.LabTab })),
);
/** DesignHub — tabbed container hosting Use Cases, Prompt, Connectors & Tools,
 *  Events & Triggers, Messaging, and Automations. */
export const DesignTab = lazy(() =>
  import('@/features/agents/sub_design').then((m) => ({ default: m.DesignHub })),
);
/** Life — the living-agent surface: Core (character), Responsibilities
 *  (standing charters + attention ledger), and Brain (episodes, self-model,
 *  proposal inbox). lazyRetry (not raw lazy) so a failed chunk fetch retries
 *  instead of caching the rejection forever. */
export const LifeTab = lazyRetry(() =>
  import('../../sub_life/LifeTab').then((m) => ({ default: m.LifeTab })),
);
