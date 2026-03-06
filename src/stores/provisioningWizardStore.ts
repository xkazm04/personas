import { create } from 'zustand';
import type { ConnectorDefinition } from '@/lib/types/types';

export type WizardPhase = 'closed' | 'select-service' | 'provisioning';

interface ProvisioningWizardStore {
  phase: WizardPhase;
  /** The connector chosen in the selection step */
  selectedConnector: ConnectorDefinition | null;
  /** When true, the wizard was opened from onboarding (empty credential state) */
  isOnboarding: boolean;

  open: (onboarding?: boolean) => void;
  selectConnector: (connector: ConnectorDefinition) => void;
  back: () => void;
  close: () => void;
}

export const useProvisioningWizardStore = create<ProvisioningWizardStore>((set) => ({
  phase: 'closed',
  selectedConnector: null,
  isOnboarding: false,

  open: (onboarding = false) =>
    set({ phase: 'select-service', selectedConnector: null, isOnboarding: onboarding }),

  selectConnector: (connector) =>
    set({ phase: 'provisioning', selectedConnector: connector }),

  back: () =>
    set((s) => {
      if (s.phase === 'provisioning') return { phase: 'select-service', selectedConnector: null };
      return { phase: 'closed', selectedConnector: null, isOnboarding: false };
    }),

  close: () =>
    set({ phase: 'closed', selectedConnector: null, isOnboarding: false }),
}));
