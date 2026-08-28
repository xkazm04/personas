import { Bot, User, Route } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { UuidLabel } from '@/features/shared/components/display/UuidLabel';

interface MemoryProvenanceProps {
  memberId: string | null;
  personaId: string | null;
  runId: string | null;
}

/**
 * Who wrote this belief, and out of what.
 *
 * `TeamMemory` has carried `member_id`, `persona_id` and `run_id` since it was
 * introduced and the panel rendered none of them: the only provenance a reader
 * got was a two-state auto/manual chip derived from a substring of `tags`. A
 * team acts on these rows, so "who wrote this" is not decoration — it is the
 * question the row has to be able to answer.
 *
 * Rendered as one quiet line under the meta chips rather than as columns, so a
 * memory with no recorded origin (a hand-written one) costs no vertical space
 * at all — the component returns nothing when all three ids are absent.
 */
export default function MemoryProvenance({ memberId, personaId, runId }: MemoryProvenanceProps) {
  const { t } = useTranslation();
  // A primitive selector: the row re-renders only when this persona's *name*
  // changes, not on every unrelated write to the persona list.
  const personaName = useAgentStore((s) =>
    personaId ? (s.personas.find((p) => p.id === personaId)?.name ?? null) : null,
  );

  if (!memberId && !personaId && !runId) return null;

  return (
    <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1 typo-body text-foreground">
      {personaId && (
        <span className="inline-flex items-center gap-1">
          <Bot className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="sr-only">{t.sharing.label_persona}</span>
          <UuidLabel value={personaId} label={personaName} />
        </span>
      )}
      {memberId && (
        <span className="inline-flex items-center gap-1">
          <User className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="sr-only">{t.pipeline.memory_member_label}</span>
          <UuidLabel value={memberId} />
        </span>
      )}
      {runId && (
        <span className="inline-flex items-center gap-1">
          <Route className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="sr-only">{t.monitor.run}</span>
          <UuidLabel value={runId} />
        </span>
      )}
    </div>
  );
}
