import { ModalShell } from '@/features/shared/components/modals/ModalShell';
import { useTranslation } from '@/i18n/useTranslation';
import { Kbd } from './Kbd';

const KEYS = [
  ['j k / ↑ ↓', 'move'], ['1-4', 'pick'], ['E', 'edit'], ['S', 'skip'], ['T', 'talk'], ['⌫', 'undo'],
  ['↵ / →', 'dossier'], ['Esc / ←', 'close'], ['Z', 'zoom'], ['R', 'rules'], ['G', 'arm'], ['N', 'amend'], ['?', 'keys'],
] as const;

/** The discoverable half of the keymap: "?" or the footer's keyboard button opens it. */
export function KeyLegend({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const s = t.athena.standup.keys;
  return (
    <ModalShell isOpen={open} onClose={onClose} titleId="standup-keys" width="sm" title={s.title} subtitle={s.subtitle} portal>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-center">
        {KEYS.map(([k, id]) => (
          <div key={id} className="contents">
            <dt><Kbd>{k}</Kbd></dt>
            <dd className="typo-body text-foreground">{s[id]}</dd>
          </div>
        ))}
      </dl>
    </ModalShell>
  );
}
