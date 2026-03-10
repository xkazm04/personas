import { ListChecks, Plug, Sliders, Hammer, CirclePlus } from 'lucide-react';
import type { WizardSidebarStep } from './steps';
import type { AdoptWizardStep } from './hooks/useAdoptReducer';
import {
  ChooseStep,
  ConnectStep,
  TuneStep,
  BuildStep,
  CreateStep,
} from './steps';

export const SIDEBAR_STEPS: WizardSidebarStep[] = [
  { key: 'choose',  label: 'Use Cases', Icon: ListChecks },
  { key: 'connect', label: 'Connect',   Icon: Plug },
  { key: 'tune',    label: 'Configure', Icon: Sliders },
  { key: 'build',   label: 'Build',     Icon: Hammer },
  { key: 'create',  label: 'Review',    Icon: CirclePlus },
];

export const STEP_COMPONENTS: Record<AdoptWizardStep, React.ComponentType> = {
  choose: ChooseStep,
  connect: ConnectStep,
  tune: TuneStep,
  build: BuildStep,
  create: CreateStep,
};
