import { lazy } from 'react';

export const ActivityTab = lazy(() =>
  import('@/features/agents/sub_activity/ActivityTab').then((m) => ({ default: m.ActivityTab })),
);
export const MatrixTab = lazy(() =>
  import('@/features/agents/sub_activity/MatrixTab').then((m) => ({ default: m.MatrixTab })),
);
export const PersonaPromptEditor = lazy(() =>
  import('@/features/agents/sub_prompt').then((m) => ({ default: m.PersonaPromptEditor })),
);
export const PersonaSettingsTab = lazy(() =>
  import('@/features/agents/sub_settings').then((m) => ({ default: m.PersonaSettingsTab })),
);
export const PersonaUseCasesTab = lazy(() =>
  import('@/features/agents/sub_use_cases/components/core/PersonaUseCasesTab').then((m) => ({ default: m.PersonaUseCasesTab })),
);
export const PersonaConnectorsTab = lazy(() =>
  import('@/features/agents/sub_connectors/components/connectors/PersonaConnectorsTab').then((m) => ({ default: m.PersonaConnectorsTab })),
);
export const DesignTab = lazy(() =>
  import('@/features/agents/sub_design/DesignTab').then((m) => ({ default: m.DesignTab })),
);
export const LabTab = lazy(() =>
  import('@/features/agents/sub_lab/components/shared/LabTab').then((m) => ({ default: m.LabTab })),
);
export const HealthTab = lazy(() =>
  import('@/features/agents/sub_health').then((m) => ({ default: m.HealthTab })),
);
export const ChatTab = lazy(() =>
  import('@/features/agents/sub_chat/ChatTab').then((m) => ({ default: m.ChatTab })),
);
export const AssertionsTab = lazy(() =>
  import('@/features/agents/sub_assertions/components/AssertionPanel').then((m) => ({ default: m.AssertionPanel })),
);
