/**
 * The key sheet, and the three ways a cell can be empty.
 *
 * The second half is not a courtesy: the page's whole argument is that a blank
 * column is three different facts, and a reader who has not been told that
 * will read every one of them as a zero.
 */
import { useId } from 'react';

import { BaseModal } from '@/lib/ui/BaseModal';

import { useWords } from './words';

const KEYS: { key: string; say: keyof ReturnType<typeof useWords>['w']['keys'] }[] = [
  { key: 'J K ↑ ↓', say: 'move' },
  { key: 'Enter →', say: 'open' },
  { key: 'Esc ←', say: 'back' },
  { key: '1 – 9', say: 'sort' },
  { key: '0', say: 'clear' },
  { key: 'D', say: 'docket' },
  { key: 'F', say: 'full' },
  { key: '1 2 3', say: 'answer' },
  { key: 'U', say: 'undo' },
  { key: '?', say: 'sheet' },
];

export function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { w } = useWords();
  const titleId = useId();

  return (
    <BaseModal isOpen={open} onClose={onClose} titleId={titleId} size="lg">
      <div className="cb-root cb-help" style={{ display: 'block', height: 'auto', overflow: 'visible' }}>
        <h2 className="typo-heading-lg" id={titleId}>
          {w.help_title}
        </h2>
        <p className="typo-body">{w.help_body}</p>
        <div className="cb-kgrid">
          {KEYS.map((row) => (
            <div className="cb-krow typo-caption" key={row.key}>
              <span className="cb-kk">
                <kbd>{row.key}</kbd>
              </span>
              <span>{w.keys[row.say]}</span>
            </div>
          ))}
        </div>
        <h3 className="typo-section-title">{w.help_three_ways}</h3>
        <div className="cb-kgrid">
          <div className="cb-krow typo-caption">
            <span className="cb-kk">
              <span className="cb-flat" style={{ width: '14px' }} />
            </span>
            <span>
              <b>{w.legend_measured_nothing}</b> {w.legend_measured_nothing_tip}
            </span>
          </div>
          <div className="cb-krow typo-caption">
            <span className="cb-kk">
              <span className="cb-unkbox" />
            </span>
            <span>
              <b>{w.legend_unknown}</b> {w.legend_unknown_tip}
            </span>
          </div>
          <div className="cb-krow typo-caption">
            <span className="cb-kk">
              <span className="cb-swatch cb-ink-unmeasurable" />
            </span>
            <span>
              <b>{w.legend_unmeasurable}</b> {w.legend_unmeasurable_tip}
            </span>
          </div>
        </div>
      </div>
    </BaseModal>
  );
}
