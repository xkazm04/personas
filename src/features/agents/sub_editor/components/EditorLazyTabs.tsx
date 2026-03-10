import { lazy } from 'react';

export const PersonaPromptEditor = lazy(() =>
  import('@/features/agents/sub_prompt').then((m) => ({ default: m.PersonaPromptEditor })),
);
export const PersonaSettingsTab = lazy(() =>
  import('@/features/agents/sub_settings').then((m) => ({ default: m.PersonaSettingsTab })),
);
export const PersonaUseCasesTab = lazy(() =>
  import('@/features/agents/sub_use_cases/components/PersonaUseCasesTab').then((m) => ({ default: m.PersonaUseCasesTab })),
);
export const PersonaConnectorsTab = lazy(() =>
  import('@/features/agents/sub_connectors/components/PersonaConnectorsTab').then((m) => ({ default: m.PersonaConnectorsTab })),
);
export const DesignTab = lazy(() =>
  import('@/features/agents/sub_design/DesignTab').then((m) => ({ default: m.DesignTab })),
);
export const LabTab = lazy(() =>
  import('@/features/agents/sub_lab/components/LabTab').then((m) => ({ default: m.LabTab })),
);
export const PromptPerformanceCard = lazy(() =>
  import('@/features/agents/sub_prompt_lab').then((m) => ({ default: m.PromptPerformanceCard })),
);
export const HealthTab = lazy(() =>
  import('@/features/agents/sub_health').then((m) => ({ default: m.HealthTab })),
);
