import { useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';

interface TriageArgs {
  /** Exactly the rows on screen, in their display order. */
  rows: AuditIncident[];
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  /** Suspended while a modal or another view owns the screen. */
  enabled: boolean;
  onOpenDetail: (incident: AuditIncident) => void;
  acknowledge: (id: string) => Promise<unknown>;
  resolve: (id: string) => Promise<boolean>;
  /** Announced through the inbox's aria-live region. */
  announce: (message: string) => void;
}

/**
 * Keyboard triage for the incidents ledger: j/k (or arrows) move the cursor,
 * Enter opens the detail modal, `a` acknowledges, `r` resolves, Esc clears.
 * Ignored while the user is typing, and suppressed via `enabled` when a modal
 * or the autonomous log is up.
 *
 * Every argument is read through a ref so the listener binds ONCE — rebinding
 * it on each focus change or 30s poll would drop keystrokes mid-triage.
 */
export function useIncidentKeyboardTriage(args: TriageArgs): void {
  const { t } = useTranslation();
  const ref = useRef(args);
  ref.current = args;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = ref.current;
      if (!cur.enabled) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) {
        return;
      }
      const list = cur.rows;
      if (list.length === 0) return;
      const curIdx = list.findIndex((i) => i.id === cur.focusedId);

      const focusAt = (idx: number) => {
        const inc = list[idx];
        if (!inc) return;
        cur.setFocusedId(inc.id);
        document.getElementById(`incident-row-${inc.id}`)?.scrollIntoView({ block: 'nearest' });
        const tt = tRef.current;
        const pos = tt.overview.incidents.a11y_position
          .replace('{current}', String(idx + 1))
          .replace('{total}', String(list.length));
        const persona = inc.personaName ? `, ${inc.personaName}` : '';
        cur.announce(`${tokenLabel(tt, 'severity', inc.severity)}, ${inc.title}${persona}. ${pos}`);
      };

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          focusAt(curIdx < 0 ? 0 : Math.min(list.length - 1, curIdx + 1));
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          focusAt(curIdx < 0 ? list.length - 1 : Math.max(0, curIdx - 1));
          break;
        case 'Enter':
          if (curIdx >= 0) {
            e.preventDefault();
            cur.onOpenDetail(list[curIdx]!);
          }
          break;
        case 'a':
          if (curIdx >= 0 && list[curIdx]!.status === 'open') {
            e.preventDefault();
            const inc = list[curIdx]!;
            void cur.acknowledge(inc.id);
            cur.announce(`${tRef.current.overview.incidents.a11y_acknowledged}: ${inc.title}`);
          }
          break;
        case 'r':
          if (curIdx >= 0 && ['open', 'acknowledged', 'in_progress'].includes(list[curIdx]!.status)) {
            e.preventDefault();
            const inc = list[curIdx]!;
            void cur.resolve(inc.id).then((ok) => {
              if (ok) cur.announce(`${tRef.current.overview.incidents.a11y_resolved}: ${inc.title}`);
            });
          }
          break;
        case 'Escape':
          cur.setFocusedId(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
