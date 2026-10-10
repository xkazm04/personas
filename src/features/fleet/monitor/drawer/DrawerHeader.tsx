// DrawerHeader — the drawer's nameplate.
//
// The header used to carry a name, a counts sentence and a close box, which
// is a title bar, not a header that earns its space on a drawer the operator
// opened ON PURPOSE to decide something. It now carries the three facts that
// change what the operator does next: who this is, whether it runs on its own
// (and whether it is an App Master), and the way out.
//
// It carried a third thing until 2026-10-06 — the strip that switched between
// three readings of the dossier. That strip was scaffold; the operator picked
// the console and the other two readings were deleted with it, so the header
// hosts no tablist any more.

import { X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaCardModel } from '../monitorModel';
import { DrawerAutonomy } from './DrawerAutonomy';

export function DrawerHeader({
  card, onClose,
}: {
  card: PersonaCardModel;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();

  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between gap-4 border-b border-border/60 bg-secondary/20 px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <PersonaIcon icon={card.personaIcon} color={card.personaColor} display="pop" frameSize="md" />
        <div className="min-w-0">
          <h3 className="truncate typo-heading text-foreground">{card.personaName}</h3>
          <p className="typo-caption text-foreground">
            {tx(t.monitor.drawer_summary, {
              reviews: Math.max(card.reviewCount, card.reviews.length),
              processes: card.processes.length,
            })}
          </p>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-4">
        {card.personaId !== 'unassigned' && (
          <DrawerAutonomy personaId={card.personaId} onNavigate={onClose} />
        )}

        <Tooltip content={t.monitor.close_hint}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.monitor.close_hint}
            onClick={onClose}
            icon={<X className="h-4 w-4" />}
          />
        </Tooltip>
      </div>
    </header>
  );
}
