/**
 * Reason lookup — maps each inbox item kind to a short "why this is here"
 * sentence shown in the row's info-icon tooltip. Surfaces the rule that
 * surfaced the item so the user understands provenance.
 */
import type { Translations } from '@/i18n/generated/types';
import type { UnifiedInboxItem } from '@/features/simple-mode/types';

export function reasonForItem(t: Translations, item: UnifiedInboxItem): string {
  const r = t.overview.inbox_triage;
  switch (item.kind) {
    case 'approval':
      return r.reason_approval;
    case 'message':
      return r.reason_message;
    case 'output':
      return r.reason_output;
    case 'health':
      return r.reason_health;
  }
}
