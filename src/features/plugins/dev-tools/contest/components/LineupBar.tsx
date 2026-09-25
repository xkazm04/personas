// Saved line-ups: one chip injects a whole panel; "Save as line-up" names
// the current panel through a small modal.
import { useId, useState } from 'react';
import { Save, Users, X } from 'lucide-react';

import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { FormField } from '@/features/shared/components/forms/FormField';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import type { ContestSeatSpec } from '@/lib/bindings/ContestSeatSpec';

import { useContestLineups } from '../hooks/useContestLineups';
import { formatSeatSpec, specsFromLineup } from '../model/seatCatalog';

interface LineupBarProps {
  panel: ContestSeatSpec[];
  onApply: (specs: ContestSeatSpec[]) => void;
  testIdPrefix: string;
}

export function LineupBar({ panel, onApply, testIdPrefix }: LineupBarProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const { lineups, remove, isLoading, error, refresh } = useContestLineups();
  const failed = !isLoading && error != null;
  const [saving, setSaving] = useState(false);
  const [dropped, setDropped] = useState(0);

  return (
    <div className="space-y-1.5" data-testid={testIdPrefix}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="typo-label text-foreground mr-1">{s.lineups_label}</span>
        {isLoading && (
          <span aria-hidden className="h-6 w-20 rounded-interactive bg-primary/[0.06]" data-testid={`${testIdPrefix}-ghost`} />
        )}
        {failed && (
          <span className="inline-flex items-center gap-1 typo-caption text-foreground" data-testid={`${testIdPrefix}-error`}>
            {s.lineups_load_failed}
            <AsyncButton size="xs" variant="ghost" onClick={refresh}>
              {t.common.retry}
            </AsyncButton>
          </span>
        )}
        {!isLoading && !failed && lineups.length === 0 && (
          <span className="typo-caption text-foreground">{s.lineups_empty}</span>
        )}
        {lineups.map((l) => (
          <span key={l.name} className="inline-flex items-center rounded-interactive border border-primary/15 bg-secondary/30">
            <Button
              size="xs"
              variant="ghost"
              icon={<Users className="w-3 h-3" />}
              aria-label={tx(s.lineup_apply, { name: l.name })}
              onClick={() => {
                const { specs, dropped: n } = specsFromLineup(l.seats);
                setDropped(n);
                onApply(specs);
              }}
              data-testid={`${testIdPrefix}-apply-${l.name}`}
            >
              {l.name}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={tx(s.lineup_delete, { name: l.name })}
              onClick={() => remove(l.name).catch(toastCatch('contest:lineup-delete'))}
            >
              <X className="w-3 h-3" />
            </Button>
          </span>
        ))}
        <Button
          size="xs"
          variant="secondary"
          icon={<Save className="w-3 h-3" />}
          disabled={panel.length === 0}
          onClick={() => setSaving(true)}
          data-testid={`${testIdPrefix}-save`}
        >
          {s.lineup_save}
        </Button>
      </div>
      {dropped > 0 && <p className="typo-caption text-foreground">{tx(s.lineup_dropped, { count: dropped })}</p>}
      {saving && (
        <SaveLineupModal
          panel={panel}
          existing={lineups.map((l) => l.name)}
          onClose={() => setSaving(false)}
        />
      )}
    </div>
  );
}

interface SaveLineupModalProps {
  panel: ContestSeatSpec[];
  existing: string[];
  onClose: () => void;
}

function SaveLineupModal({ panel, existing, onClose }: SaveLineupModalProps) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const { upsert } = useContestLineups();
  const [name, setName] = useState('');
  const titleId = useId();
  const trimmed = name.trim();

  const save = async () => {
    try {
      await upsert({ name: trimmed, seats: panel.map(formatSeatSpec) });
      useToastStore.getState().addToast(s.lineup_saved, 'success');
      onClose();
    } catch (err) {
      toastCatch('contest:lineup-save')(err);
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId={titleId} size="sm" portal>
      <div className="rounded-modal border border-primary/20 bg-background shadow-elevation-3 p-4 space-y-4">
        <h2 id={titleId} className="typo-section-title">
          {s.lineup_save_title}
        </h2>
        <p className="typo-code text-foreground break-words">{panel.map(formatSeatSpec).join(', ')}</p>
        <FormField
          label={s.lineup_name_label}
          hint={existing.includes(trimmed) ? s.lineup_name_taken : undefined}
        >
          {(p) => (
            <input
              {...p}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={s.lineup_name_placeholder}
              className={INPUT_FIELD}
            />
          )}
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <AsyncButton variant="primary" disabled={!trimmed} onClick={save} data-testid="contest-lineup-save-confirm">
            {s.lineup_save}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
