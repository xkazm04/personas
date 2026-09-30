/**
 * Observability (composition kit): the healing audit log (actions healing tried and could not
 * finish) as a collapsed level-2 Section. Opening it fetches once per persona per 30 s; the rows
 * are ListRows whose Mark is a soft warning, the entry's kind and subsystem in the meta.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { KitButton, ListRow, Meta, Rows, Section } from '@/features/shared/components/kit';
import { listHealingAuditLog } from '@/api/overview/healing';
import type { HealingAuditEntry } from '@/lib/bindings/HealingAuditEntry';
import { silentCatch } from '@/lib/silentCatch';
import type { ObservabilityWords } from '../libs/useObservabilityWords';

const CACHE_MS = 30_000;

export function HealingAuditLog({ personaId, w }: { personaId: string | null; w: ObservabilityWords }) {
  const { o } = w;
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HealingAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const cache = useRef<{ personaId: string | null; ts: number }>({ personaId: null, ts: 0 });

  const fetchAudit = useCallback(async () => {
    const key = personaId ?? null;
    if (cache.current.personaId === key && Date.now() - cache.current.ts < CACHE_MS) return;
    setLoading(true);
    setFailed(false);
    try {
      setEntries(await listHealingAuditLog(personaId ?? undefined, 50));
      cache.current = { personaId: key, ts: Date.now() };
    } catch (err) {
      silentCatch('HealingAuditLog:fetchAudit')(err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => { if (open) void fetchAudit(); }, [open, fetchAudit]);

  const retry = () => { cache.current = { personaId: null, ts: 0 }; void fetchAudit(); };
  return (
    <Section
      level={2}
      title={o.healing_issues_panel.healing_audit_log}
      count={open && !loading && !failed ? entries.length : undefined}
      state={open && loading ? 'loading' : open && failed ? 'empty' : undefined}
      empty={{ title: o.errorRecovery.audit_fetch_failed, hint: o.errorRecovery.audit_fetch_cause, tone: 'warning', action: <KitButton onClick={retry}>{o.errorRecovery.action_retry}</KitButton> }}
      actions={
        <KitButton quiet onClick={() => setOpen((v) => !v)} testId="obs-audit-toggle">
          {open ? o.review.backlog_collapse : o.review.backlog_expand}
        </KitButton>
      }
    >
      {open && (
        <Rows count={entries.length} empty={{ title: o.healing_issues_panel.no_silent_failures, tone: 'success' }}>
          {entries.map((e) => (
            <ListRow
              key={e.id}
              size="s"
              name={e.message}
              nameClass="typo-body k-regular"
              meta={<Meta parts={[e.eventType.replace(/_/g, ' '), e.subsystem, e.detail]} />}
              mark={{ tone: 'warning', glyph: 'soft', label: e.eventType }}
              time={<RelativeTime timestamp={e.createdAt} format="elapsed" showTooltip={false} />}
            />
          ))}
        </Rows>
      )}
    </Section>
  );
}
