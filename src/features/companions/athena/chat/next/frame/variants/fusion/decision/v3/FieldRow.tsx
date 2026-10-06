/**
 * Fusion · decision v3 - the typed answer as the palette's input row on a
 * card of its own: a pen where the palette has its search glass, the field,
 * and the legend of what Enter does there (send, ⇧↵ new line) - or, for an
 * approval's note, that it rides along with the answer picked above.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest.
 */

import { PenLine } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { CardField } from '../../../c/bodies/model';
import { FUSION_COPY as F } from '../../copy';
import { Keycap, Legend } from './parts';
import { PALETTE_COPY as P } from './copy';

export function FieldRow({ field }: { field: CardField }) {
  const submit = field.submit;
  return (
    <label className="fd3-field fd3-surface glass-md rounded-card" data-testid="companion-fusion-d3-field">
      <span className="fd3-field-head">
        <PenLine className="fd3-field-g" aria-hidden />
        <span className="typo-label text-foreground">{field.label || F.answer}</span>
      </span>
      <textarea
        className={`${INPUT_FIELD} typo-body fd3-input`}
        rows={field.multiline ? 3 : 1}
        value={field.value}
        placeholder={field.placeholder}
        disabled={field.disabled}
        onChange={(e) => field.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && submit?.enabled) {
            e.preventDefault();
            void submit.run();
          }
        }}
      />
      <span className="fd3-field-foot">
        {submit ? (
          <>
            {field.multiline && <Legend keys={[P.keys.shiftEnter]} label={P.newLine} />}
            <span className="flex-1" />
            <Button
              variant="primary"
              size="sm"
              className="fd3-send"
              loading={submit.busy}
              disabled={!submit.enabled}
              onClick={() => void submit.run()}
              aria-keyshortcuts="Enter"
              data-testid="companion-fusion-d3-send"
            >
              {submit.label}
              <Keycap>{P.keys.enter}</Keycap>
            </Button>
          </>
        ) : (
          <span className="typo-caption">{P.noteRides}</span>
        )}
      </span>
    </label>
  );
}
