import { lazy } from 'react';

export const ActivityTab = lazy(() =>
  import('@/features/agents/sub_activity/ActivityTab').then((m) => ({ default: m.ActivityTab })),
);
export const MatrixTab = lazy(() =>
  import('@/features/agents/sub_activity/MatrixTab').then((m) => ({ default: m.MatrixTab })),
);
export const PersonaSettingsTab = lazy(() =>
  import('@/features/agents/sub_settings').then((m) => ({ default: m.PersonaSettingsTab })),
);
export const PersonaUseCasesTab = lazy(() =>
  import('@/features/agents/sub_use_cases/components/core/PersonaUseCasesTab').then((m) => ({ default: m.PersonaUseCasesTab })),
);
export const LabTab = lazy(() =>
  import('@/features/agents/sub_lab/components/shared/LabTab').then((m) => ({ default: m.LabTab })),
);
export const ChatTab = lazy(() =>
  import('@/features/agents/sub_chat/ChatTab').then((m) => ({ default: m.ChatTab })),
);
/** DesignHub — umbrella that also renders the former Prompt / Connectors / Health surfaces. */
export const DesignTab = lazy(() =>
  import('@/features/agents/sub_design').then((m) => ({ default: m.DesignHub })),
);
