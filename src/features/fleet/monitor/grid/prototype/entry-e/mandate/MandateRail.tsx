// The mandate page's rail: the doors that act on the SELECTED act - revert it
// (V), take its scope back (N) - then the envelope as a plate, read-only.
// Suspend acts on the whole mandate, so it sits in the title row
// (`MandateHead`), not here. Signing and widening are the Sign card's (WP5),
// so they are not offered here at all rather than shown disabled. Each key
// sits clear of its label, so a label that wraps never runs into its keycap.
//
// Every door awaits its write (AsyncButton) and reports a refusal in place:
// an irreversible act says why before anything is pressed, and if the backend
// refuses anyway (`forbidden`) the same reason stays on screen.

import { Shrink, Undo2 } from 'lucide-react';
import { AsyncButton } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { CharterAct } from '@/lib/bindings/CharterAct';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { Kbd } from '../parts';
import { EnvelopePlate } from './EnvelopePlate';
import { asScope, scopeLabel } from './mandateCopy';

/** The scope the selected act was taken under, when the envelope still grants it. */
export function narrowableScope(mandate: MandateSummary, act: CharterAct | null) {
  const scope = act ? asScope(act.scope) : null;
  if (!scope || mandate.envelope.envelopeVersion === 0) return null;
  return mandate.envelope.decideScopes.includes(scope) ? scope : null;
}

/** A door's key, kept clear of its label: the button's gap plus its own margin. */
function RailKey({ k }: { k: string }) {
  return <span className="ml-1.5 inline-flex"><Kbd>{k}</Kbd></span>;
}

export function canRevert(act: CharterAct | null): boolean {
  return !!act && act.reversible && act.revertedAt === null && act.itemKind !== 'act.revert';
}

export function MandateRail({ mandate, held, act, notice, onRevert, onNarrow }: {
  mandate: MandateSummary;
  held: number | null;
  /** The selected act, or null. */
  act: CharterAct | null;
  /** The last refusal or failure, said in place. */
  notice: string | null;
  onRevert: () => Promise<void>;
  onNarrow: () => Promise<void>;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const narrow = narrowableScope(mandate, act);

  return (
    <aside className="flex w-[300px] flex-shrink-0 flex-col gap-3 overflow-y-auto" data-testid="mandate-rail">
      <div className="flex flex-col gap-2">
        {act && (canRevert(act) ? (
          <AsyncButton variant="secondary" size="sm" block onClick={onRevert} icon={<Undo2 className="h-4 w-4" aria-hidden />} iconRight={<RailKey k="V" />} aria-keyshortcuts="V" data-testid="mandate-revert">
            {m.ml_revert}
          </AsyncButton>
        ) : (
          <p className="typo-caption" data-testid="mandate-revert-reason">
            {act.revertedAt ? m.ml_revert_already : act.itemKind === 'act.revert' ? m.ml_revert_is_revert : m.ml_revert_final}
          </p>
        ))}
        {narrow && (
          <AsyncButton variant="secondary" size="sm" block onClick={onNarrow} icon={<Shrink className="h-4 w-4" aria-hidden />} iconRight={<RailKey k="N" />} aria-keyshortcuts="N" data-testid="mandate-narrow">
            {tx(m.ml_narrow, { scope: scopeLabel(m, narrow) })}
          </AsyncButton>
        )}
        <p className="typo-caption text-status-warning empty:hidden" role="status" data-testid="mandate-notice">{notice}</p>
      </div>
      <EnvelopePlate mandate={mandate} held={held} />
    </aside>
  );
}
