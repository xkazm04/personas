import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * The `?` sheet: every key the Table shell answers to, in one place, so no
 * shortcut is undiscoverable. It lives in a portal, so its look is scoped to
 * `.tb-keys-sheet`, not to the shell root.
 */
export function TableKeysSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const c = t.athena;
  const rows: Array<[string[], string]> = [
    [['Enter'], c.table_key_continue],
    [['1', '2', '3'], c.table_key_pick],
    [['Space'], c.table_key_hear],
    [['B'], c.table_key_back],
    [['S'], c.table_key_skip],
    [['?'], c.table_key_keys],
    [['Esc'], c.table_key_close],
  ];
  return (
    <BaseModal isOpen={open} onClose={onClose} titleId="create-athena-table-keys-title" size="md" portal>
      <div className="tb-keys-sheet" data-testid="create-athena-table-keys-sheet">
        <div className="tb-keys-head">
          <h2 id="create-athena-table-keys-title" className="typo-section-title">{c.table_keys_title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>{c.table_key_close}</Button>
        </div>
        <div className="tb-keys">
          {rows.map(([keys, label]) => (
            <div key={label}>
              <span>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
              <span className="typo-body">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </BaseModal>
  );
}
