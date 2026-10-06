/**
 * Fusion · the question, as its own calm block at the head of the stage:
 * who asks (an eyebrow in the kind's ink with its glyph), the question large,
 * its context quiet under it, the machine detail behind a reveal, and a foot
 * with the door to her opinion ("Ask Athena · 0") and the product's
 * deferrals. The queue rides in the head as glyph pips with "2 of 8"; the
 * answers are NOT in here - they are separate cards under it (`AnswerCards`).
 *
 * The keys are shown ON the controls they drive, not in a legend line under
 * everything (which is what clipped Filament's options at 1280x800): each
 * answer's number is its key, "Ask Athena" carries 0, her pick carries Enter,
 * the queue carries the arrows, "Set aside" carries Space, the fold Esc.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { ShieldAlert } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { NEXT_COPY as N } from '../../../nextCopy';
import { KIND_VAR } from '../../../tones';
import type { WorkItem } from '../../../useWorkforce';
import type { CardModel } from '../c/bodies/model';
import { KIND_GLYPH } from '../filament/filamentArt';
import { AthenaSeal } from './AthenaSeal';
import { FUSION_COPY as F } from './copy';
import type { QueueNav } from './DecisionStage';
import { inline, splitLead } from './text';

function Pips({ nav }: { nav: QueueNav }) {
  const at = nav.items.findIndex((i) => i.id === nav.activeId);
  return (
    <nav className="fu-pips" aria-label={F.queue} data-testid="companion-fusion-queue">
      {nav.items.map((it) => {
        const Glyph = KIND_GLYPH[it.kind];
        return (
          <Tooltip key={it.id} content={`${N.kind[it.kind]} · ${it.project ?? F.athena}`}>
            <Button
              variant="ghost"
              className="fu-pip"
              style={{ ['--c' as string]: KIND_VAR[it.kind] }}
              aria-current={it.id === nav.activeId}
              aria-label={N.kind[it.kind]}
              onClick={() => nav.onPick(it.id)}
            >
              <Glyph aria-hidden />
            </Button>
          </Tooltip>
        );
      })}
      <span className="typo-caption fu-of tabular-nums">{F.itemOf(at + 1, nav.items.length)}</span>
      {nav.items.length > 1 && (
        <span className="fu-keys" aria-hidden>
          <kbd className="fu-kbd typo-caption">←</kbd>
          <kbd className="fu-kbd typo-caption">→</kbd>
        </span>
      )}
    </nav>
  );
}

function HerWord({ model, herOwn }: { model: CardModel; herOwn: boolean }) {
  const rec = model.recommendation;
  if (!rec) return null;
  // Revealed onto a card: the card carries it, the foot stays quiet.
  if (rec.revealed && rec.text && model.choices.some((c) => c.recommended)) return null;
  if (rec.revealed && rec.text) {
    return (
      <p className="fu-verdict typo-body-lg text-foreground" data-testid="companion-fusion-verdict">
        {herOwn ? <AthenaSeal size={26} /> : <ShieldAlert className="fu-verdict-g" aria-hidden />}
        <span>
          <span className="typo-label text-primary block">{rec.label}</span>
          {rec.text}
        </span>
      </p>
    );
  }
  if (rec.composing) {
    return (
      <p className="fu-verdict typo-body text-foreground" aria-busy>
        <AthenaSeal size={26} />
        {F.composing}
      </p>
    );
  }
  return (
    <>
      {rec.reveal && (
        <Button variant="ghost" className="fu-askher typo-body" onClick={rec.reveal} aria-keyshortcuts="0" data-testid="companion-fusion-ask">
          <AthenaSeal size={26} />
          {F.askHer}
          <kbd className="fu-kbd typo-caption">0</kbd>
        </Button>
      )}
      {rec.failed && <p className="typo-body text-status-warning">{rec.failed}</p>}
    </>
  );
}

export function QuestionBlock({
  model,
  item,
  nav,
}: {
  model: CardModel | null;
  item: WorkItem;
  nav: QueueNav;
}) {
  const Glyph = KIND_GLYPH[item.kind];
  const { lead, rest } = model ? splitLead(model.question) : { lead: '', rest: '' };
  const deferrals = model?.deferrals ?? [];
  const aside = (
    <Button variant="ghost" size="sm" className="fu-keybtn" onClick={nav.onAside} aria-keyshortcuts="Space" data-testid="companion-fusion-aside">
      {F.keys.aside}
      <kbd className="fu-kbd typo-caption">Space</kbd>
    </Button>
  );
  return (
    <section className="fu-question fu-glass" style={{ ['--c' as string]: KIND_VAR[item.kind] }} data-testid="companion-fusion-question">
      <div className="fu-q-head">
        <p className="fu-eyebrow typo-eyebrow">
          <Glyph aria-hidden />
          {model ? model.eyebrow : N.kind[item.kind]}
        </p>
        <span className="flex-1" />
        {/* A strip, not a block, when the product's own card is the body. */}
        {!model && aside}
        <Pips nav={nav} />
        <Tooltip content={F.keys.fold}>
          <Button
            variant="ghost"
            size="xs"
            className="fu-keybtn"
            onClick={nav.onFold}
            aria-label={F.keys.fold}
            aria-keyshortcuts="Escape"
            data-testid="companion-fusion-fold-stage"
          >
            <kbd className="fu-kbd typo-caption">Esc</kbd>
          </Button>
        </Tooltip>
      </div>
      {model && (
        <>
          <h2 className="fu-q typo-heading-lg text-foreground">{inline(lead)}</h2>
          {rest && <p className="fu-ctx typo-body-lg">{inline(rest)}</p>}
          {model.context && <p className="fu-ctx typo-body">{inline(model.context)}</p>}
        </>
      )}
      {model?.details && (
        <details className="fu-details">
          <summary className="typo-body">{F.details}</summary>
          <pre className="typo-code">{model.details.code}</pre>
        </details>
      )}
      {model?.error && <p className="typo-body text-status-error" role="alert">{model.error}</p>}
      {model?.warning && <p className="typo-body text-status-warning" role="alert">{model.warning}</p>}
      {model && (
      <div className="fu-q-foot">
        <HerWord model={model} herOwn={item.kind === 'decision'} />
        <span className="flex-1" />
        {aside}
        {deferrals.map((d) => (
          <Tooltip key={d.key} content={d.hint}>
            <Button variant="ghost" size="sm" onClick={d.run}>
              {d.label}
            </Button>
          </Tooltip>
        ))}
      </div>
      )}
    </section>
  );
}
