import { create } from 'zustand';
import type { ConnectorDefinition } from '@/lib/types/types';

export type WizardPhase = 'closed' | 'detect' | 'batch';

interface ProvisioningWizardStore {
  phase: WizardPhase;
  /** Connectors selected for batch provisioning (single = batch with 1 item) */
  selectedConnectors: ConnectorDefinition[];
  /** When true, the wizard was opened from onboarding (empty credential state) */
  isOnboarding: boolean;

  open: (onboarding?: boolean) => void;
  /** Select one or more connectors and go to batch phase */
  selectConnectors: (connectors: ConnectorDefinition[]) => void;
  back: () => void;
  close: () => void;
}

export const useProvisioningWizardStore = create<ProvisioningWizardStore>((set) => ({
  phase: 'closed',
  selectedConnectors: [],
  isOnboarding: false,

  open: (onboarding = false) =>
    set({ phase: 'detect', selectedConnectors: [], isOnboarding: onboarding }),

  selectConnectors: (connectors) =>
    set({ phase: 'batch', selectedConnectors: connectors }),

  back: () =>
    set((s) => {
      if (s.phase === 'batch') {
        return { phase: 'detect', selectedConnectors: [] };
      }
      return { phase: 'closed', selectedConnectors: [], isOnboarding: false };
    }),

  close: () =>
    set({ phase: 'closed', selectedConnectors: [], isOnboarding: false }),
}));
