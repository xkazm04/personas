/**
 * The style studio's corner of the table: one line on where it stands and the
 * way into the deck. When drafts are waiting it lights up — they are offers
 * like any other, and nothing is written until they are kept.
 */

import { Palette } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { StyleStudioPhase } from '../../../setup/style/styleContract';

interface StyleDockProps {
  phase: StyleStudioPhase;
  styleName: string | null;
  onOpen: () => void;
}

export function StyleDock({ phase, styleName, onOpen }: StyleDockProps) {
  const { t, tx } = useTranslation();
  const xo = t.twin.experience_opus.style;
  const working = phase === 'rolling' || phase === 'materializing' || phase === 'applying';
  const waiting = phase === 'preview' || phase === 'candidates';

  const status =
    phase === 'materializing'
      ? tx(xo.drafting, { name: styleName ?? '' })
      : phase === 'rolling'
        ? xo.rolling
        : phase === 'candidates'
          ? xo.candidatesReady
          : phase === 'preview'
            ? tx(xo.draftsReady, { name: styleName ?? '' })
            : phase === 'applying'
              ? xo.saving
              : xo.idle;

  return (
    <div
      className={`xo-card xo-foil xo-suit-tone rounded-card p-3 space-y-2 ${waiting ? 'xo-foil-live xo-glow' : ''}`}
      data-testid="xo-style-dock"
    >
      <p className="flex items-center gap-2 typo-title text-foreground">
        <Palette className="w-4 h-4 text-[var(--xo-hue)]" aria-hidden />
        {xo.title}
      </p>
      <p className="typo-caption" role="status">
        {status}
      </p>
      {working && <span aria-hidden className="block h-1.5 w-2/3 rounded-pill bg-secondary/70" />}
      <Button
        variant={waiting ? 'accent' : 'secondary'}
        accentColor="violet"
        size="sm"
        onClick={onOpen}
        data-testid="xo-style-dock-open"
      >
        {waiting ? xo.review : xo.open}
      </Button>
    </div>
  );
}

export default StyleDock;
