/**
 * Fusion · decision v2 - a typed answer (a session's guidance question, an
 * approval's note) as a wide tile of its own: the same band and icon tile as
 * the answers, the product's input, and - when the field sends on its own -
 * its real keys (Enter sends, Shift+Enter breaks a line) beside the send verb.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - consolidate after the owner picks.
 */

import { PenLine } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { CardField } from '../../../c/bodies/model';
import { FUSION_COPY as F } from '../../copy';
import { V2_COPY as C } from './copy';

export function FieldTile({ field }: { field: CardField }) {
  const submit = field.submit;
  return (
    <label className="k-dtile d2-ans is-field" data-testid="companion-fusion-d2-field">
      <span className="d2-ans-head">
        <span className="d2-icon" aria-hidden>
          <PenLine />
        </span>
        <span className="typo-title-lg">{field.label || F.answer}</span>
        {submit && (
          <span className="d2-field-keys typo-caption" aria-hidden>
            <kbd className="d2-key typo-code">Enter</kbd>
            {C.enterSends}
            <kbd className="d2-key typo-code">{C.shiftEnterKey}</kbd>
            {C.shiftEnter}
          </span>
        )}
      </span>
      <textarea
        className={`${INPUT_FIELD} typo-body d2-input`}
        rows={field.multiline ? 3 : 1}
        value={field.value}
        placeholder={field.placeholder}
        disabled={field.disabled}
        aria-keyshortcuts={submit ? 'Enter' : undefined}
        onChange={(e) => field.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && submit?.enabled) {
            e.preventDefault();
            void submit.run();
          }
        }}
      />
      {submit && (
        <span className="d2-field-foot">
          <Button variant="primary" size="sm" loading={submit.busy} disabled={!submit.enabled} onClick={() => void submit.run()}>
            {submit.label}
          </Button>
        </span>
      )}
    </label>
  );
}
