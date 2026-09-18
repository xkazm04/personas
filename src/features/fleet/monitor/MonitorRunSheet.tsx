// MonitorRunSheet — the payload prompt behind a capability sigil in the
// Monitor drawer.
//
// The sigil used to dispatch the charter's own sample input and nothing else,
// which makes the drawer a place to fire fixtures rather than a place to do
// work. This sheet puts the real payload one keystroke away while keeping the
// fire-the-sample path as an explicit second action, so the previous one-click
// behaviour is still reachable and still honest about what it sends.

import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';

export interface MonitorRunSheetProps {
  /** Capability title, shown so the operator can see what they are firing. */
  title: string;
  /** The charter's declared sample, already serialized, or undefined when the
   *  capability declares none. */
  sample: string | undefined;
  /** Dispatch with this exact payload string (undefined = send nothing). */
  onRun: (input: string | undefined) => Promise<void>;
  onCancel: () => void;
}

/** Pretty-print a serialized sample so it is editable rather than one long
 *  line. A sample that is not JSON is shown verbatim — it is still what the
 *  capability declared, and rewriting it would be a lie about the default. */
export function formatSampleForEditing(sample: string | undefined): string {
  if (!sample) return '';
  try {
    return JSON.stringify(JSON.parse(sample), null, 2);
  } catch {
    return sample;
  }
}

function isParseableJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function MonitorRunSheet({ title, sample, onRun, onCancel }: MonitorRunSheetProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => formatSampleForEditing(sample));

  const trimmed = text.trim();
  // Advisory only. Every existing dispatch from this grid sent JSON, but the
  // command takes a string and a capability may legitimately want prose, so a
  // non-JSON payload is flagged rather than blocked.
  const jsonWarning = useMemo(
    () => trimmed.length > 0 && !isParseableJson(trimmed),
    [trimmed],
  );

  return (
    <BaseModal isOpen onClose={onCancel} titleId="monitor-run-title" size="md" portal>
      <div className="flex flex-col max-h-[75vh]" data-testid="monitor-run-sheet">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-card-border/60 shrink-0">
          <Play className="w-4 h-4 text-primary shrink-0" aria-hidden />
          <h2 id="monitor-run-title" className="typo-label text-foreground truncate">{title}</h2>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3">
          <p className="typo-caption text-foreground/90 leading-snug mb-2">{t.monitor.run_sheet_hint}</p>
          <label htmlFor="monitor-run-input" className="typo-label text-foreground block mb-1">
            {t.monitor.run_sheet_input_label}
          </label>
          <textarea
            id="monitor-run-input"
            data-testid="monitor-run-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            spellCheck={false}
            className="w-full px-2.5 py-2 rounded-input border border-card-border bg-secondary/40 typo-code font-mono text-foreground focus:outline-none focus:border-primary/45 transition-colors resize-y"
          />
          {jsonWarning && (
            <p data-testid="monitor-run-json-warning" className="typo-caption text-status-warning mt-1">
              {t.monitor.run_sheet_invalid_json}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-card-border/60 shrink-0">
          <Button variant="ghost" size="sm" onClick={onCancel}>{t.common.cancel}</Button>
          <span className="flex-1" />
          <AsyncButton
            size="sm"
            variant="ghost"
            disabled={!sample}
            data-testid="monitor-run-sample"
            onClick={() => onRun(sample)}
          >
            {t.monitor.run_sheet_run_sample}
          </AsyncButton>
          <AsyncButton
            size="sm"
            variant="primary"
            data-testid="monitor-run-confirm"
            onClick={() => onRun(trimmed.length > 0 ? trimmed : undefined)}
          >
            {t.monitor.run}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
