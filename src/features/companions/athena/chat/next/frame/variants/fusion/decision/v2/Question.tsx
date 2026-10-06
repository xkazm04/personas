/**
 * Fusion · decision v2 ("Overview tiles") - the question as a HERO TILE, built
 * the way Personas builds its Overview: the kit's band tile (`.k-dtile`, a
 * 2px rail on the left, right-only radius, the stepped surface) lit in the
 * kind's ink the way Mission Control lights an annunciator, its status Mark on
 * the rail, and a head composed like the app's page header (`ContentHeader`:
 * a tinted icon tile beside a mono-caps caption over a heading-lg line).
 * Under it the context as a readable lede, the stakes as the kit's chips, the
 * parameters as the kit's key-value grid behind a reveal, and a foot with
 * the door to her opinion and the product's deferrals.
 *
 * With no model (a kind whose body is the product's own card) it is a one-row
 * strip that carries the queue and the keys.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - consolidate after the owner picks.
 */

import { motion } from 'framer-motion';
import { SquareTerminal } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { KitHost, Mark } from '@/features/shared/components/kit';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { NEXT_COPY as N } from '../../../../../nextCopy';
import { KIND_VAR } from '../../../../../tones';
import type { WorkItem } from '../../../../../useWorkforce';
import type { CardModel } from '../../../c/bodies/model';
import type { QueueNav } from '../../DecisionStage';
import { KIND_GLYPH } from '../../kindGlyph';
import { EASE, inline, splitLead } from '../../text';
import { V2_COPY as C } from './copy';
import { Details } from './Details';
import { HerDoor } from './HerDoor';
import { AsideButton, QueueBar } from './QueueBar';
import { Stakes } from './Stakes';
import { KIND_TONE, useProvenance } from './useProvenance';

function Asker({ item }: { item: WorkItem }) {
  if (item.kind === 'session_request') return <SquareTerminal className="d2-asker-g" aria-hidden />;
  return <span className="fu-face-sm" aria-hidden />;
}

export function Question({ model, item, nav }: { model: CardModel | null; item: WorkItem; nav: QueueNav }) {
  const { shouldAnimate } = useMotion();
  const prov = useProvenance(item, model);
  const herOwn = item.kind === 'decision';
  const Glyph = KIND_GLYPH[item.kind];
  const { lead, rest } = model ? splitLead(model.question) : { lead: item.title, rest: '' };
  const lede = [rest, model?.context].filter(Boolean) as string[];
  return (
    <KitHost>
      <motion.section
        className={`k-dtile d2-q${model ? '' : ' is-strip'}`}
        style={{ ['--c' as string]: KIND_VAR[item.kind] }}
        initial={shouldAnimate ? { opacity: 0, y: -10 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: EASE }}
        aria-label={model ? lead : item.title}
        data-testid="companion-fusion-d2-question"
      >
        <Mark tone={KIND_TONE[item.kind]} glyph="solid" label={C.waitingOnYou} />
        {model && (
          <span className="d2-art-clip" aria-hidden>
            <Glyph className="d2-art is-hero" />
          </span>
        )}
        <header className="d2-q-head">
          <span className="d2-icon is-lg" aria-hidden>
            <Glyph />
          </span>
          <p className="d2-caption typo-caption text-foreground">
            <Asker item={item} />
            {model ? model.eyebrow : N.kind[item.kind]}
          </p>
          <QueueBar nav={nav} aside={model ? null : <AsideButton nav={nav} />} />
          {model ? (
            <h2 className="d2-q-title typo-heading-lg text-foreground">{inline(lead)}</h2>
          ) : (
            <p className="d2-q-title is-strip typo-title text-foreground">{item.title}</p>
          )}
        </header>
        {lede.map((t, i) => (
          <p key={i} className={`d2-lede ${i === 0 ? 'typo-body-lg' : 'typo-body'} text-foreground`}>
            {inline(t)}
          </p>
        ))}
        {!model && <Stakes item={item} model={null} prov={prov} herOwn={herOwn} />}
        {model?.details && <Details code={model.details.code} />}
        {model?.error && <p className="typo-body text-status-error" role="alert">{model.error}</p>}
        {model?.warning && <p className="typo-body text-status-warning" role="alert">{model.warning}</p>}
        {model && (
          <footer className="d2-q-foot">
            <HerDoor model={model} herOwn={herOwn} />
            <Stakes item={item} model={model} prov={prov} herOwn={herOwn} />
            <span className="flex-1" />
            <AsideButton nav={nav} />
            {model.deferrals.map((d) => (
              <Tooltip key={d.key} content={d.hint}>
                <Button variant="ghost" size="sm" className="focus-ring" onClick={d.run}>
                  {d.label}
                </Button>
              </Tooltip>
            ))}
          </footer>
        )}
      </motion.section>
    </KitHost>
  );
}
