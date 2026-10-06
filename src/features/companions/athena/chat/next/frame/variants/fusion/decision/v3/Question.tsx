/**
 * Fusion · decision v3 ("Command palette") - the question as the palette's
 * input row. Personas' command palette (`shared/chrome/CommandPalette.tsx`)
 * is a `glass-md` panel whose head row is an icon, the field and an `ESC`
 * key cap over a primary hairline, and whose foot is a legend of key caps.
 * Here the field IS the question: the head row carries the kind's icon tile,
 * the provenance trail (Athena · project · who asks, the kit's `Crumbs`),
 * since when, the queue and Esc; the question sits large under it with its
 * context; the foot is the palette's legend, made of real keys.
 *
 * With no model (the product's own card is the body) it is only the head
 * row: a strip that carries the queue and the keys.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest.
 */

import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Crumbs } from '@/features/shared/components/kit';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { NEXT_COPY as N } from '../../../../../nextCopy';
import { KIND_VAR } from '../../../../../tones';
import type { WorkItem } from '../../../../../useWorkforce';
import type { CardModel } from '../../../c/bodies/model';
import type { QueueNav } from '../../DecisionStage';
import { KIND_GLYPH } from '../../kindGlyph';
import { EASE, inline, splitLead } from '../../text';
import { Footer, Verdict } from './Footer';
import { AsideKey, FoldKey, QueueSwitch } from './parts';
import { PALETTE_COPY as P } from './copy';
import './palette.css';

/** Athena first, then the project, then who asks (an eyebrow that names Athena drops to the kind). */
function trail(model: CardModel | null, item: WorkItem) {
  const who = model && !model.eyebrow.startsWith(P.athena) ? model.eyebrow : N.kind[item.kind];
  return [P.athena, item.project, who].filter((s): s is string => !!s).map((label) => ({ label }));
}

/** A decision's createdAtMs is a placeholder (stamped when the queue is read), so it states no "since". */
const since = (item: WorkItem) => item.createdAtMs > 0 && item.kind !== 'decision';

function Head({ model, item, nav }: { model: CardModel | null; item: WorkItem; nav: QueueNav }) {
  const Glyph = KIND_GLYPH[item.kind];
  return (
    <header className="fd3-q-head">
      <span className="fd3-kind" aria-hidden>
        <Glyph />
      </span>
      <span className="fd3-trail">
        <Crumbs items={trail(model, item)} label={P.provenance} testId="companion-fusion-d3-provenance" />
        {!model && <span className="typo-title text-foreground fd3-strip-title">{item.title}</span>}
      </span>
      {since(item) && <RelativeTime timestamp={item.createdAtMs} className="typo-caption fd3-since" />}
      {!model && <AsideKey nav={nav} />}
      <QueueSwitch nav={nav} />
      <FoldKey nav={nav} />
    </header>
  );
}

export function Question({ model, item, nav }: { model: CardModel | null; item: WorkItem; nav: QueueNav }) {
  const { shouldAnimate } = useMotion();
  const { lead, rest } = model ? splitLead(model.question) : { lead: '', rest: '' };
  const herOwn = item.kind === 'decision';
  return (
    <motion.section
      className={`fd3-q fd3-surface glass-md rounded-card shadow-elevation-4${model ? '' : ' is-strip'}`}
      style={{ ['--c' as string]: KIND_VAR[item.kind] }}
      initial={shouldAnimate ? { opacity: 0, y: -8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      data-testid="companion-fusion-d3-question"
    >
      <Head model={model} item={item} nav={nav} />
      {model && (
        <div className="fd3-q-body">
          <h2 className="fd3-q-text typo-heading-lg text-foreground">{inline(lead)}</h2>
          {rest && <p className="fd3-ctx typo-body-lg text-foreground">{inline(rest)}</p>}
          {model.context && <p className="fd3-ctx typo-caption">{inline(model.context)}</p>}
          {model.details && (
            <details className="fd3-details" data-testid="companion-fusion-d3-details">
              <summary className="typo-caption">
                <ChevronRight className="fd3-chev" aria-hidden />
                {model.details.label}
              </summary>
              <pre className="typo-code">{model.details.code}</pre>
            </details>
          )}
          <Verdict model={model} herOwn={herOwn} />
          {model.error && <p className="typo-body text-status-error" role="alert">{model.error}</p>}
          {model.warning && <p className="typo-body text-status-warning" role="alert">{model.warning}</p>}
        </div>
      )}
      {model && <Footer model={model} nav={nav} />}
    </motion.section>
  );
}
