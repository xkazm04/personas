import { CheckCircle2, AlertCircle } from 'lucide-react';
import type { FleetHookStatus } from '@/lib/bindings/FleetHookStatus';
import { DebtText } from '@/i18n/DebtText';
import { FleetSettingsCard } from './FleetSettingsCard';

/**
 * The per-event hook checklist as one wrapping row of chips. A present entry
 * is a neutral chip with a success check; a missing one takes the warning
 * chip recipe and an alert glyph, so the odd one out is found at a glance.
 * The "installed" / "not installed" suffix each row used to carry repeated
 * what the glyph and the banner above already say.
 */
export function FleetHookEntries({ status }: { status: FleetHookStatus }) {
  // A set: an event can be reported in both lists (a duplicated entry), and a key must be unique.
  const events = [...new Set([...status.presentEvents, ...status.missingEvents])].sort();
  return (
    <FleetSettingsCard title={<DebtText k="auto_hook_entries_e7af67cb" />}>
      <ul className="flex flex-wrap gap-1.5">
        {events.map((event) => {
          const present = status.presentEvents.includes(event);
          return (
            <li
              key={event}
              className={`inline-flex items-center gap-1.5 rounded-interactive border px-2 py-0.5 ${
                present
                  ? 'border-primary/10 bg-secondary/30 text-foreground'
                  : 'border-status-warning/30 bg-status-warning/10 text-status-warning'
              }`}
            >
              {present
                ? <CheckCircle2 className="w-3.5 h-3.5 text-status-success shrink-0" aria-hidden="true" />
                : <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
              <code className="typo-code">{event}</code>
              {/* The existing (untranslated) state words, kept for screen readers only. */}
              <span className="sr-only">{present ? 'installed' : 'not installed'}</span>
            </li>
          );
        })}
      </ul>
    </FleetSettingsCard>
  );
}
