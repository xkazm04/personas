/**
 * Fusion · decision v1 · the review card's header row, as Manual Review's
 * focus card draws it (`overview/sub_manual-review/components/ReviewFocusFlow.tsx`):
 * a framed avatar of whoever asks, their name in the accent beside a kind
 * badge and a risk badge, a quiet line under it (what the ask is, since when,
 * where), and on the right the queue as ONE row - "3 of 8", then the
 * arrows with the kind-coloured dots between them - and the fold key beside it.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest.
 */

import { ArrowLeft, ArrowRight, Clock, FolderGit2, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { KIND_VAR } from '../../../../../tones';
import type { WorkItem } from '../../../../../useWorkforce';
import type { CardModel } from '../../../c/bodies/model';
import type { QueueNav } from '../../DecisionStage';
import { KIND_GLYPH } from '../../kindGlyph';
import { DESK_COPY as C } from './copy';
import { askerOf, askLine, kindGlyph, kindLabel, riskOf } from './provenance';

const DOTS = 12;

function ink(v: string) {
  return { ['--b' as string]: v };
}

function Queue({ nav }: { nav: QueueNav }) {
  const at = nav.items.findIndex((i) => i.id === nav.activeId);
  const many = nav.items.length > 1;
  const step = (d: 1 | -1) => nav.onPick(nav.items[(at + d + nav.items.length) % nav.items.length]!.id);
  return (
    <nav className="d1-queue" aria-label={C.review(at + 1, nav.items.length)} data-testid="companion-fusion-d1-queue">
      <span className="d1-count typo-label text-foreground tabular-nums" aria-hidden>
        {C.position(at + 1, nav.items.length)}
      </span>
      <span className="d1-queue-row">
        {many && (
          <Tooltip content={C.prev}>
            <Button variant="ghost" size="xs" className="d1-keybtn" onClick={() => step(-1)} aria-label={C.prev} aria-keyshortcuts="ArrowLeft">
              <kbd className="d1-kbd typo-code">
                <ArrowLeft aria-hidden />
              </kbd>
            </Button>
          </Tooltip>
        )}
        <span className="d1-dots">
          {nav.items.slice(0, DOTS).map((it) => (
            <Tooltip key={it.id} content={`${C.kind[it.kind]} · ${it.project ?? C.athena}`}>
              <Button
                variant="ghost"
                className="d1-dot"
                style={ink(KIND_VAR[it.kind])}
                aria-current={it.id === nav.activeId}
                aria-label={C.kind[it.kind]}
                onClick={() => nav.onPick(it.id)}
              />
            </Tooltip>
          ))}
          {nav.items.length > DOTS && <span className="typo-caption">+{nav.items.length - DOTS}</span>}
        </span>
        {many && (
          <Tooltip content={C.next}>
            <Button variant="ghost" size="xs" className="d1-keybtn" onClick={() => step(1)} aria-label={C.next} aria-keyshortcuts="ArrowRight">
              <kbd className="d1-kbd typo-code">
                <ArrowRight aria-hidden />
              </kbd>
            </Button>
          </Tooltip>
        )}
      </span>
    </nav>
  );
}

export function Avatar({ item, athena }: { item: WorkItem; athena: boolean }) {
  const Glyph = KIND_GLYPH[item.kind];
  return athena ? (
    <span className="d1-avatar is-athena" aria-hidden>
      <span className="d1-portrait" />
    </span>
  ) : (
    <span className="d1-avatar" style={ink(KIND_VAR[item.kind])} aria-hidden>
      <Glyph />
    </span>
  );
}

export function DeskHead({ item, model, nav, aside }: { item: WorkItem; model: CardModel | null; nav: QueueNav; aside?: ReactNode }) {
  const Glyph = kindGlyph(item, model);
  const who = askerOf(item);
  const risk = riskOf(model);
  const line = askLine(item, model);
  return (
    <header className="d1-head">
      <Avatar item={item} athena={who.athena} />
      <div className="d1-who">
        <p className="d1-who-line">
          <span className="typo-title d1-name">{who.name}</span>
          <span className="d1-badge typo-label" style={ink(KIND_VAR[item.kind])} data-testid="companion-fusion-d1-kind">
            <Glyph aria-hidden />
            {kindLabel(item, model)}
          </span>
          {risk && (
            <span className="d1-badge typo-label" style={ink(risk === 'low' ? 'var(--status-success)' : 'var(--status-warning)')} data-testid="companion-fusion-d1-risk">
              {risk === 'low' ? <ShieldCheck aria-hidden /> : <ShieldAlert aria-hidden />}
              {C.risk[risk]}
            </span>
          )}
        </p>
        <p className="d1-meta typo-caption">
          {line && <span className="d1-meta-ask">{line}</span>}
          {item.createdAtMs > 0 && (
            <span className="d1-meta-bit">
              <Clock aria-hidden />
              <RelativeTime timestamp={item.createdAtMs} />
            </span>
          )}
          {who.name !== item.project && (
            <span className="d1-meta-bit">
              <FolderGit2 aria-hidden />
              {item.project ?? C.appWide}
            </span>
          )}
        </p>
      </div>
      <div className="d1-head-end">
        <Queue nav={nav} />
        {aside}
        <Tooltip content={C.fold}>
          <Button variant="ghost" size="xs" className="d1-keybtn" onClick={nav.onFold} aria-label={C.fold} aria-keyshortcuts="Escape" data-testid="companion-fusion-d1-fold">
            <kbd className="d1-kbd typo-code">Esc</kbd>
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
