import { lazy } from 'react';
import { ListChecks, Plug, Sliders, Hammer, CirclePlus } from 'lucide-react';
import type { WizardSidebarStep } from './steps';
import type { AdoptWizardStep } from './hooks/useAdoptReducer';

const ChooseStep = lazy(() =>
  import('./steps/choose/ChooseStep').then((m) => ({ default: m.ChooseStep })),
);
const ConnectStep = lazy(() =>
  import('./steps/connect/ConnectStep').then((m) => ({ default: m.ConnectStep })),
);
const TuneStep = lazy(() =>
  import('./steps/tune/TuneStep').then((m) => ({ default: m.TuneStep })),
);
const BuildStep = lazy(() =>
  import('./steps/build/BuildStep').then((m) => ({ default: m.BuildStep })),
);
const CreateStep = lazy(() =>
  import('./steps/create/CreateStep').then((m) => ({ default: m.CreateStep })),
);

export const SIDEBAR_STEPS: WizardSidebarStep[] = [
  { key: 'choose',  label: 'Use Cases', Icon: ListChecks },
  { key: 'connect', label: 'Connect',   Icon: Plug },
  { key: 'tune',    label: 'Configure', Icon: Sliders },
  { key: 'build',   label: 'Build',     Icon: Hammer },
  { key: 'create',  label: 'Review',    Icon: CirclePlus },
];

export const STEP_COMPONENTS: Record<AdoptWizardStep, React.LazyExoticComponent<React.ComponentType>> = {
  choose: ChooseStep,
  connect: ConnectStep,
  tune: TuneStep,
  build: BuildStep,
  create: CreateStep,
};
