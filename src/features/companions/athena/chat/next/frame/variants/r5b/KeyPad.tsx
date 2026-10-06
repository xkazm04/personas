/**
 * Choices as physical keys: a numbered cap, the verb, its consequence. Athena's
 * pick is BACKLIT (lit border, inner glow, its LED on) and her one-line reason
 * reads beside the pad with the Enter cap that confirms it. Before she is
 * asked, the pad carries a 0 key that asks her. Keys are the shared `Button`,
 * so a verb in flight shows the real spinner.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import Button from '@/features/shared/components/buttons/Button';
import type { CardChoice, CardModel } from '../c/bodies/model';
import { R5B_COPY as C } from './copy';
import { inline } from './promptText';

const toneVar = (c: CardChoice) => (c.tone === 'danger' ? 'var(--status-error)' : 'var(--primary)');

export function Cap({ children }: { children: string }) {
  return <kbd className="r5b-cap rounded-interactive px-1.5 typo-code text-foreground whitespace-nowrap">{children}</kbd>;
}

function Key({ choice, n, busy }: { choice: CardChoice; n: number; busy: boolean }) {
  return (
    <Button
      variant="ghost"
      size="lg"
      block
      loading={choice.busy}
      disabled={busy && !choice.busy}
      onClick={choice.run}
      data-r5b-key=""
      data-testid={choice.testId ? `companion-r5b-${choice.testId}` : undefined}
      aria-keyshortcuts={String(n)}
      className={`r5b-key${choice.recommended ? ' lit' : ''} relative !rounded-card !px-4 !pt-3 !pb-3.5 h-full !items-start !justify-start text-left`}
      style={{ ['--t' as string]: choice.recommended ? 'var(--primary)' : toneVar(choice) }}
    >
      <span className="flex flex-col gap-1.5 min-w-0">
        <span className="typo-data-lg tabular-nums text-foreground">{n}</span>
        <span className="r5b-led absolute top-4 right-4" aria-hidden />
        <span className={`typo-title ${choice.tone === 'danger' ? 'text-status-error' : 'text-foreground'}`}>{inline(choice.label)}</span>
        {choice.hint && <span className="typo-caption [overflow-wrap:anywhere]">{choice.hint}</span>}
      </span>
    </Button>
  );
}

function AskKey({ onAsk }: { onAsk: () => void }) {
  return (
    <Button
      variant="ghost"
      size="lg"
      block
      onClick={onAsk}
      data-r5b-key=""
      data-testid="companion-r5b-ask-athena"
      aria-keyshortcuts="0"
      className="r5b-key !rounded-card !px-4 !pt-3 !pb-3.5 h-full !items-start !justify-start text-left border-dashed"
      style={{ ['--t' as string]: 'var(--primary)' }}
    >
      <span className="flex flex-col gap-1.5 min-w-0">
        <span className="typo-data-lg tabular-nums text-primary">0</span>
        <span className="typo-title">{C.askKey}</span>
        <span className="typo-caption">{C.askHint}</span>
      </span>
    </Button>
  );
}

export function KeyPad({ model }: { model: CardModel }) {
  const rec = model.recommendation;
  const ask = rec && !rec.revealed && rec.reveal ? rec.reveal : null;
  const cells = model.choices.length + (ask ? 1 : 0);
  const cols = cells <= 2 ? 'sm:grid-cols-2' : cells === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4';
  return (
    <div className={`grid grid-cols-1 ${cols} gap-3`} role="group" data-testid="companion-r5b-keys">
      {model.choices.map((c, i) => (
        <Key key={c.key} choice={c} n={i + 1} busy={model.busy} />
      ))}
      {ask && <AskKey onAsk={ask} />}
    </div>
  );
}
