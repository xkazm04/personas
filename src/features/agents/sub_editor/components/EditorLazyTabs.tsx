import { lazy } from 'react';

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
