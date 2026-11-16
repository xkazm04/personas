/**
 * This PC: the name the operator's other PCs see when they pair with it, with
 * a rename in place.
 *
 * The name is the p2p identity's `display_name` (`set_display_name` through
 * the network slice), because that is what the pairing handshake carries and
 * what another PC stores as `OwnedDevice.displayName`. It is deliberately NOT
 * `sub_account/DeviceNameField`, which edits the cloud-sync heartbeat name a
 * paired phone reads - a different setting with its own command.
 */
import { useEffect, useState } from 'react';
import { ContextCard, ContextCards, Ghost, Section } from '@/features/shared/components/kit';
import { FormField } from '@/features/shared/components/forms/FormField';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

/** Matches the 64-character cap the identity settings field enforces. */
const MAX_NAME = 64;

export function ThisPcCard() {
  const { t } = useTranslation();
  const st = t.sharing;
  const identity = useSystemStore((s) => s.localIdentity);
  const fetchLocalIdentity = useSystemStore((s) => s.fetchLocalIdentity);
  const setDisplayName = useSystemStore((s) => s.setDisplayName);
  const addToast = useToastStore((s) => s.addToast);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchLocalIdentity();
  }, [fetchLocalIdentity]);

  const trimmed = draft.trim();
  const canSave = trimmed !== '' && trimmed !== identity?.display_name;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await setDisplayName(trimmed);
      setEditing(false);
      addToast(st.display_name_updated, 'success');
    } catch (err) {
      toastCatch('features/settings/sub_devices/ThisPcCard:rename', st.display_name_update_failed)(err);
    } finally {
      setSaving(false);
    }
  };

  const startEditing = () => {
    setDraft(identity?.display_name ?? '');
    setEditing(true);
  };

  return (
    <Section title={st.this_pc_label}>
      <div data-testid="this-pc-card">
        <ContextCards label={st.this_pc_label}>
          <ContextCard
            title={identity ? identity.display_name : <Ghost width="40%" height="12px" />}
            meta={st.this_pc_hint}
            mark={{ tone: 'primary', glyph: 'solid', label: st.this_pc_label }}
            actions={
              !editing && identity ? (
                <Button variant="secondary" size="sm" onClick={startEditing} data-testid="this-pc-rename">
                  {st.this_pc_rename}
                </Button>
              ) : undefined
            }
          >
            {editing ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <FormField label={st.this_pc_name_label}>
                    {(inputProps) => (
                      <input
                        {...inputProps}
                        type="text"
                        value={draft}
                        maxLength={MAX_NAME}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void save();
                          if (e.key === 'Escape') setEditing(false);
                        }}
                        className={INPUT_FIELD}
                        data-testid="this-pc-name-input"
                      />
                    )}
                  </FormField>
                </div>
                <Button size="sm" loading={saving} disabled={!canSave} onClick={() => void save()} data-testid="this-pc-name-save">
                  {st.save}
                </Button>
                <Button variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
                  {st.cancel}
                </Button>
              </div>
            ) : undefined}
          </ContextCard>
        </ContextCards>
      </div>
    </Section>
  );
}
