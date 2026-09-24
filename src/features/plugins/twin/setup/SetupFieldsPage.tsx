/**
 * SetupFieldsPage — the typed escape hatch the voice/elicitation standard
 * requires: every slot the guided conversation can fill is ALSO reachable here,
 * directly, without saying a word.
 *
 * It was a right-side drawer until 2026-09-16, and a drawer was the wrong
 * container for it: the biography, the voice directives and the examples are
 * the longest text in the product and they were being typed through a column
 * narrower than a phone. This is the same surface as page content — one band
 * per checklist slot, in `SETUP_FOCUS_ORDER`, across the full width of the body.
 *
 * It is deliberately independent of the generator. When `session.generatorError`
 * is set the conversation cannot propose anything, and this page is how the user
 * still finishes their twin, so nothing here is gated on the guide having
 * succeeded — which is also why the error notice in the chrome switches to this
 * mode rather than offering a retry.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { hubSlotForFocus, type TwinSlotId } from '../shared/twinStatus';
import {
  SETUP_FOCUS_ORDER,
  type SetupChecklistItem,
  type SetupFieldEdit,
  type SetupFocus,
  type SetupSessionApi,
} from './setupContract';
import { SetupFieldsSection, sectionDomId } from './fields/SetupFieldsSection';
import { IdentityFields } from './fields/IdentityFields';
import { ToneFields } from './fields/ToneFields';
import { SlotSummary } from './fields/SlotSummary';

/** How long a jumped-to section stays marked. Long enough to find, short enough to forget. */
const SPOTLIGHT_MS = 1600;

export interface SetupFieldsJump {
  slot: SetupFocus;
  /** New object per click, so pointing at the same slot twice re-triggers. */
  at: number;
}

interface SetupFieldsPageProps {
  session: SetupSessionApi;
  /** Current values, so the page opens on what is actually stored. */
  values: Partial<Record<string, string>>;
  /** A readiness-strip or buffer click while this mode is open. */
  jump: SetupFieldsJump | null;
  onOpenHub: (slot: TwinSlotId) => void;
  /** Hand a slot back to the guided conversation, which is where it is asked. */
  onAskGuide: (slot: SetupFocus) => void;
}

export function SetupFieldsPage({
  session,
  values,
  jump,
  onOpenHub,
  onAskGuide,
}: SetupFieldsPageProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup;
  const [spotlight, setSpotlight] = useState<SetupFocus | null>(null);

  // A strip click in this mode SCROLLS rather than asking the generator a new
  // question: there is no question on this surface to replace.
  useEffect(() => {
    if (!jump) return;
    document.getElementById(sectionDomId(jump.slot))?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    setSpotlight(jump.slot);
    const timer = window.setTimeout(() => setSpotlight(null), SPOTLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [jump]);

  const commit =
    (change: Omit<SetupFieldEdit, 'value'>) =>
    (value: string): Promise<void> =>
      session.edit({ ...change, value } as SetupFieldEdit);

  const bodyOf = (item: SetupChecklistItem) => {
    switch (item.id) {
      case 'identity':
        return <IdentityFields values={values} commit={commit} />;
      case 'tone':
        return <ToneFields channels={session.toneChannels} values={values} commit={commit} />;
      case 'channels':
        return (
          <SlotSummary
            body={ts.fields.channelsBody}
            actionLabel={ts.fields.askGuide}
            onAction={() => onAskGuide('channels')}
            testId="setup-fields-jump-channels"
          />
        );
      case 'memories': {
        // The join lives in `twinStatus`, so a slot that later moves between
        // the two tabs moves here too rather than being re-decided.
        const hubSlot = hubSlotForFocus('memories');
        return (
          <SlotSummary
            body={ts.fields.memoriesBody}
            actionLabel={ts.desk.openHub}
            onAction={() => hubSlot && onOpenHub(hubSlot)}
            testId="setup-fields-jump-memories"
          />
        );
      }
    }
  };

  const byId = new Map(session.checklist.map((item) => [item.id, item]));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-testid="setup-fields-page">
      <div className="px-4 md:px-6 xl:px-8 py-5">
        <div className="mb-4">
          <h2 className="typo-section-title">{ts.fieldsTitle}</h2>
          <p className="typo-caption">{ts.fieldsHint}</p>
        </div>

        <div className="space-y-4">
          {SETUP_FOCUS_ORDER.map((id) => {
            const item = byId.get(id);
            if (!item) return null;
            return (
              <SetupFieldsSection key={id} item={item} spotlit={spotlight === id}>
                {bodyOf(item)}
              </SetupFieldsSection>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SetupFieldsPage;
