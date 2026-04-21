import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { ExecutionDetail } from '@/features/agents/sub_executions/detail/ExecutionDetail';
import { useTranslation } from '@/i18n/useTranslation';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

interface ExecutionDetailModalProps {
  execution: PersonaExecution & { persona_name?: string | null };
  onClose: () => void;
}

/** Shared modal used by both the Agents and Overview activity lists to inspect
 *  a single execution. Keeps the two feature modules from drifting apart and
 *  intentionally omits the raw execution ID from the header — users told us
 *  the internal identifier is noise, not context. */
export function ExecutionDetailModal({ execution, onClose }: ExecutionDetailModalProps) {
  const { t, tx } = useTranslation();
  const personaName = execution.persona_name || t.overview.activity.unknown;
  const startedAt = execution.started_at ?? execution.created_at;
  return (
    <DetailModal
      title={tx(t.agents.activity.modal_execution_title, { name: personaName })}
      subtitle={startedAt ? formatRelativeTime(startedAt) : undefined}
      onClose={onClose}
    >
      <ExecutionDetail execution={execution} />
    </DetailModal>
  );
}
