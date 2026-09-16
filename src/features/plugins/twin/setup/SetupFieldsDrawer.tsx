/**
 * SetupFieldsDrawer — the typed escape hatch the voice/elicitation standard
 * requires: every slot the guided conversation can fill is ALSO reachable
 * here, directly, without saying a word.
 *
 * It is deliberately independent of the generator. When `session.generatorError`
 * is set the conversation cannot propose anything, and this drawer is how the
 * user still finishes their twin, so nothing here is gated on the guide having
 * succeeded. Each field commits through `session.edit` on blur and wears its
 * own outcome, so a failed write is visible at the field rather than only in a
 * toast that has already gone.
 */

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { FormField } from '@/features/shared/components/forms/FormField';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupFieldEdit, SetupSessionApi } from './setupContract';

const TITLE_ID = 'twin-setup-fields-title';

interface SetupFieldsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  session: SetupSessionApi;
  /** Current values, so the drawer opens on what is actually stored. */
  values: Partial<Record<string, string>>;
}

type CommitState = 'idle' | 'saving' | 'saved' | 'error';

function DrawerField({
  label,
  slotKey,
  initial,
  multiline,
  mono,
  helpText,
  edit,
}: {
  label: string;
  slotKey: string;
  initial: string;
  multiline?: boolean;
  mono?: boolean;
  helpText?: string;
  edit: (value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [state, setState] = useState<CommitState>('idle');
  const lastInitial = useRef(initial);

  // Adopt a value that changed underneath us — the guide accepted a proposal
  // while the drawer was open. Keyed on the incoming value changing, never on
  // every render, so it cannot fight a user mid-keystroke.
  useEffect(() => {
    if (lastInitial.current === initial) return;
    lastInitial.current = initial;
    setDraft(initial);
    setState('idle');
  }, [initial]);

  const commit = async () => {
    if (draft === initial) { setState('idle'); return; }
    setState('saving');
    try {
      await edit(draft);
      setState('saved');
    } catch (err) {
      setState('error');
      toastCatch('features/plugins/twin/setup/SetupFieldsDrawer:commit')(err);
    }
  };

  const ts = t.twin.setup.fields;
  const note = state === 'saving' ? ts.saving : state === 'saved' ? ts.saved : state === 'error' ? ts.saveFailed : helpText;

  return (
    <FormField label={label} helpText={note} error={state === 'error' ? ts.saveFailed : undefined} validateOn="change">
      {(inputProps) =>
        multiline ? (
          <textarea
            {...inputProps}
            rows={5}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setState('idle'); }}
            onBlur={() => void commit()}
            data-testid={`setup-field-${slotKey}`}
            className={`${INPUT_FIELD} resize-y leading-relaxed`}
          />
        ) : (
          <input
            {...inputProps}
            type="text"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setState('idle'); }}
            onBlur={() => void commit()}
            data-testid={`setup-field-${slotKey}`}
            className={mono ? `${INPUT_FIELD} font-mono` : INPUT_FIELD}
          />
        )
      }
    </FormField>
  );
}

export function SetupFieldsDrawer({ isOpen, onClose, session, values }: SetupFieldsDrawerProps) {
  const { t, tx } = useTranslation();
  const ts = t.twin.setup;
  if (!isOpen) return null;

  const commit = (change: Omit<SetupFieldEdit, 'value'>) => (value: string) =>
    session.edit({ ...change, value } as SetupFieldEdit);

  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} placement="right-drawer" portal staggerChildren={false}>
      <div className="contents">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10">
          <div className="flex-1 min-w-0">
            <div id={TITLE_ID} className="typo-section-title truncate">{ts.fieldsTitle}</div>
            <div className="typo-caption">{ts.fieldsHint}</div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={ts.close} icon={<X className="w-4 h-4" />} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4" data-testid="setup-fields-drawer">
          <DrawerField label={ts.fields.name} slotKey="name" initial={values.name ?? ''} edit={commit({ field: 'name' })} />
          <DrawerField label={ts.fields.role} slotKey="role" initial={values.role ?? ''} edit={commit({ field: 'role' })} />
          <DrawerField
            label={ts.fields.bio}
            slotKey="bio"
            initial={values.bio ?? ''}
            multiline
            helpText={ts.fields.bioHint}
            edit={commit({ field: 'bio' })}
          />
          <DrawerField
            label={ts.fields.obsidianSubpath}
            slotKey="obsidianSubpath"
            initial={values.obsidianSubpath ?? ''}
            mono
            helpText={ts.fields.obsidianSubpathHint}
            edit={commit({ field: 'obsidianSubpath' })}
          />

          <div className="pt-2 border-t border-primary/10 space-y-4">
            <p className="typo-caption uppercase tracking-[0.18em]">{ts.fields.toneGroup}</p>
            {session.toneChannels.map((channel) => (
              <DrawerField
                key={channel}
                label={tx(ts.fields.toneFor, { channel })}
                slotKey={`tone-${channel}`}
                initial={values[`tone:${channel}`] ?? ''}
                multiline
                edit={commit({ field: 'tone', channel })}
              />
            ))}
          </div>
        </div>
      </div>
    </BaseModal>
  );
}

export default SetupFieldsDrawer;
