/**
 * Fusion · decision v1 ("Review desk") · the question as the header card of
 * Personas' own review world: Manual Review's focus card (a modal-radius
 * panel with a 2px ink bar along its top, in the kind's colour, and that
 * colour's soft glow), its persona header (`DeskHead`), the ask as a
 * title (a step under `typo-heading-lg`, only ever the first sentence or clause)
 * over its reasoning on a darker inset panel, the machine detail behind the
 * app's disclosure (ApprovalCard's "Action parameters"), the gradient rule,
 * then the action zone: the door to Athena's opinion on the left, the ways
 * past the item on the right. With no model (the product's own card is the
 * body) it collapses to the header row alone - a strip that carries the
 * queue and the keys.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest.
 */

import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { KIND_VAR } from '../../../../../tones';
import type { WorkItem } from '../../../../../useWorkforce';
import type { CardModel } from '../../../c/bodies/model';
import type { QueueNav } from '../../DecisionStage';
import { EASE, inline, splitLead } from '../../text';
import { DESK_COPY as C } from './copy';
import { DeskHead } from './DeskHead';
import { HerDoor } from './HerDoor';

function Aside({ nav }: { nav: QueueNav }) {
  return (
    <Tooltip content={C.asideHint}>
      <Button variant="ghost" size="sm" className="d1-keybtn" onClick={nav.onAside} aria-keyshortcuts="Space" data-testid="companion-fusion-d1-aside">
        {C.aside}
        <kbd className="d1-kbd typo-code">Space</kbd>
      </Button>
    </Tooltip>
  );
}

function Body({ model }: { model: CardModel }) {
  const { lead, rest } = splitLead(model.question);
  return (
    <div className="d1-body">
      {lead && (
        <h2 className="d1-title typo-heading-lg text-foreground" data-testid="companion-fusion-d1-title">
          {inline(lead)}
        </h2>
      )}
      {(rest || model.context) && (
        <div className="d1-desc" data-testid="companion-fusion-d1-desc">
          {rest && <p className="d1-prose typo-body text-foreground">{inline(rest)}</p>}
          {model.context && <p className="d1-prose is-context typo-caption">{inline(model.context)}</p>}
        </div>
      )}
      {model.details && (
        <details className="d1-details" data-testid="companion-fusion-d1-details">
          <summary className="typo-caption focus-ring">
            <ChevronRight className="d1-chev" aria-hidden />
            {C.details}
          </summary>
          <pre className="typo-code">{model.details.code}</pre>
        </details>
      )}
      {model.error && (
        <p className="d1-alert is-error typo-caption" role="alert">
          {model.error}
        </p>
      )}
      {model.warning && (
        <p className="d1-alert is-warn typo-caption" role="alert">
          {model.warning}
        </p>
      )}
    </div>
  );
}

export function Question({ model, item, nav }: { model: CardModel | null; item: WorkItem; nav: QueueNav }) {
  const { shouldAnimate } = useMotion();
  const deferrals = model?.deferrals ?? [];
  return (
    <motion.section
      className={`d1-q${model ? '' : ' is-strip'}`}
      style={{ ['--c' as string]: KIND_VAR[item.kind] }}
      initial={shouldAnimate ? { opacity: 0, y: -10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      aria-label={C.kind[item.kind]}
      tabIndex={-1}
      data-fusion-question=""
      data-testid="companion-fusion-d1-question"
    >
      <DeskHead item={item} model={model} nav={nav} aside={model ? undefined : <Aside nav={nav} />} />
      {model && (
        <>
          <Body model={model} />
          <div className="d1-rule" aria-hidden />
          <footer className="d1-foot">
            <HerDoor model={model} herOwn={item.kind === 'decision'} />
            <span className="flex-1" />
            <Aside nav={nav} />
            {deferrals.map((d) => (
              <Tooltip key={d.key} content={d.hint}>
                <Button variant="ghost" size="sm" onClick={d.run} data-testid={`companion-fusion-d1-${d.key}`}>
                  {d.label}
                </Button>
              </Tooltip>
            ))}
          </footer>
        </>
      )}
    </motion.section>
  );
}
