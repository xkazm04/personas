/**
 * The one control a step is on the collar rail: a roving-focus Button that
 * opens the step's Layer-2 screen (`openStep`, which also selects it), carries
 * the rail's test ids and state attributes (its card's peek explains the
 * verdict, so the key carries no tooltip of its own). Its name is what the card
 * shows: the step, its verdict, its figure ("Done rate 40%") and its binding. `stretch` spreads its hit area over the nearest
 * positioned ancestor (the kit's stretched press), so a whole cell or card is
 * the target while the tab stop stays one element.
 *
 * A pointer or focus resting on the key warms the step's screen: its chunks
 * and its detail data (`layer2/stepChunks`), cancelled when it leaves.
 */
import type { ReactNode } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { Button } from '@/features/shared/components/buttons';
import type { ButtonSize } from '@/features/shared/components/buttons/Button';

import { bindingStateLabel, stepLabel } from '../../../journey/journeyLabels';
import type { StepRoving } from '../../blocks/useStepRoving';
import { useLifecycleViewModel } from '../../context';
import { cancelStepIntent, prefetchStepOnIntent } from '../../layer2/stepChunks';
import type { HealthStep } from '../healthModel';
import { healthLabel, metricLabel } from '../layer1Labels';
import { figureWords } from '../rail/FigureValue';

const STRETCH = "after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-primary/60";

interface StepPressProps {
  step: HealthStep;
  index: number;
  roving: StepRoving;
  size?: ButtonSize;
  stretch?: boolean;
  className?: string;
  children: ReactNode;
}

export function StepPress({ step, index, roving, size = 'icon-lg', stretch = true, className = '', children }: StepPressProps) {
  const { dl, tx, projectId, selected, openStep } = useLifecycleViewModel();
  const { language } = useTranslation();
  const { node } = step;
  const label = stepLabel(dl, node.id, node.label);
  const intent = () => prefetchStepOnIntent(projectId, node.id);
  const value = step.figure ? figureWords(step.figure, language) : null;
  const figure = step.figure && value ? `${metricLabel(dl, step.figure.key)} ${value}` : null;
  return (
    <Button
      ref={roving.bind(index)}
      variant="ghost"
      size={size}
      tabIndex={index === roving.activeIndex ? 0 : -1}
      aria-pressed={node.id === selected?.id}
      onClick={() => openStep(node.id)}
      onPointerEnter={intent}
      onPointerLeave={cancelStepIntent}
      onFocus={intent}
      onBlur={cancelStepIntent}
      aria-label={figure
        ? tx(dl.lcx10_node_label, { step: label, health: healthLabel(dl, step.health), figure, state: bindingStateLabel(dl, node.strongestState) })
        : tx(dl.lc1_node_label, { step: label, health: healthLabel(dl, step.health), state: bindingStateLabel(dl, node.strongestState) })}
      data-testid={`lc-node-${node.id}`}
      data-state={node.strongestState}
      data-health={step.health}
      className={`hover:bg-transparent ${stretch ? STRETCH : ''} ${className}`}
    >
      {children}
    </Button>
  );
}
