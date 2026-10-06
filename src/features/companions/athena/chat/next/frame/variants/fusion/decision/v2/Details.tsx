/**
 * Fusion · decision v2 - what it will run, behind a reveal: an object of
 * parameters reads as the kit's key-value grid (quiet keys over regular
 * values, the way every Personas detail pane states facts); anything else
 * stays as the code it is.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - consolidate after the owner picks.
 */

import { ChevronRight } from 'lucide-react';
import { KeyValueGrid, type KeyValueItem } from '@/features/shared/components/kit';
import { FUSION_COPY as F } from '../../copy';

function facts(code: string): KeyValueItem[] | null {
  try {
    const v: unknown = JSON.parse(code);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const rows = Object.entries(v as Record<string, unknown>);
    if (rows.length === 0 || rows.length > 12) return null;
    return rows.map(([k, val]) => ({
      k: k.replace(/[_-]+/g, ' '),
      v: val == null ? null : typeof val === 'object' ? JSON.stringify(val) : String(val),
      none: '-',
    }));
  } catch {
    // Not JSON: shown as the code it is.
    return null;
  }
}

export function Details({ code }: { code: string }) {
  const items = facts(code);
  return (
    <details className="d2-details" data-testid="companion-fusion-d2-details">
      <summary className="d2-summary typo-label text-foreground focus-ring">
        <ChevronRight className="d2-chev" aria-hidden />
        {F.details}
      </summary>
      {items ? <KeyValueGrid items={items} min="11rem" /> : <pre className="d2-code typo-code">{code}</pre>}
    </details>
  );
}
