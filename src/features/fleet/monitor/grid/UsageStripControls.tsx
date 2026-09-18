// UsageStripControls — the right end of the strip's header row: auto-rotate,
// its threshold, and the last rotation.
//
// Multi-plan only, and that is not an omission: rotation is a choice between
// plans, so with one login there is nothing for the loop to rotate TO and a
// disabled toggle would be describing a feature the operator cannot have yet.
//
// The "not stored yet" notice and its Store button that used to sit here are
// gone: the live login is stored on sight (`useAutoCapture`), so there is no
// state left for the notice to describe.
//
// The threshold input is UNCOMMITTED WHILE FOCUSED and saved on blur. Typing
// "8" on the way to "80" would otherwise write 8% and rotate the fleet on the
// next read — the local `draft` exists for exactly that half-typed instant.

import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import type { ClaudeAccountsSnapshot } from '@/lib/bindings/ClaudeAccountsSnapshot';

export function UsageStripControls({
  snapshot, onSave,
}: {
  snapshot: ClaudeAccountsSnapshot;
  onSave: (enabled: boolean, thresholdPct: number) => void;
}) {
  const { t, tx } = useTranslation();
  const [draft, setDraft] = useState<number | null>(null);
  const autoRotate = snapshot.autoRotate;
  const shown = draft ?? autoRotate.thresholdPct;

  return (
    <div className="flex min-w-0 items-center gap-3" data-testid="fleet-usage-controls">
      {/* The last rotation is history, not a state — it recedes to a legible
          trace and comes to full on hover, so it stops competing with the
          controls beside it for the first read of the row. */}
      {snapshot.lastRotation && (
        <span className="min-w-0 truncate opacity-40 transition-opacity hover:opacity-100">
          {tx(t.monitor.usage_last_rotation, {
            from: snapshot.lastRotation.fromEmail,
            to: snapshot.lastRotation.toEmail,
          })}
          {' · '}
          <RelativeTime timestamp={snapshot.lastRotation.atMs} />
        </span>
      )}

      <Tooltip content={t.monitor.usage_auto_rotate_hint}>
        <span className="inline-flex flex-shrink-0 items-center gap-1.5">
          <AccessibleToggle
            size="sm"
            checked={autoRotate.enabled}
            onChange={() => onSave(!autoRotate.enabled, shown)}
            label={t.monitor.usage_auto_rotate}
          />
          <span>{t.monitor.usage_auto_rotate}</span>
          <input
            type="number"
            min={1}
            max={100}
            step={5}
            value={shown}
            aria-label={t.monitor.usage_auto_rotate_threshold_aria}
            onChange={(e) => setDraft(Number(e.target.value))}
            onBlur={() => {
              const pct = Math.max(1, Math.min(100, Math.round(shown)));
              setDraft(null);
              if (pct !== autoRotate.thresholdPct) onSave(autoRotate.enabled, pct);
            }}
            className="w-12 rounded-input border border-border bg-background px-1 py-0 text-right typo-caption tabular-nums text-foreground"
            data-testid="fleet-usage-rotate-threshold"
          />
          <span className="opacity-60">%</span>
        </span>
      </Tooltip>
    </div>
  );
}

export default UsageStripControls;
