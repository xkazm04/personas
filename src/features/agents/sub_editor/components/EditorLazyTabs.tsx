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
/** DesignHub — tabbed container hosting the Manifest, Responsibilities, Brain
 *  and Connectors sub-tabs (`DesignSubTab`); the former Use Cases, Prompt,
 *  Health and Life tabs all land here via `setEditorTab`'s legacy remaps. */
export const DesignTab = lazy(() =>
  import('@/features/agents/sub_design').then((m) => ({ default: m.DesignHub })),
);
