import { useTranslation } from '@/i18n/useTranslation';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { CharterToolbar } from './CharterToolbar';
import { CharterDraftInbox } from './CharterDraftInbox';
import { CharterEditor } from './CharterEditor';
import type { CharterStatus } from './CharterStatusLadder';

interface CharterMasterHeaderProps {
  personaId: string;
  counts: Record<CharterStatus, number>;
  statusFilter: string | null;
  onStatusFilter: (status: string | null) => void;
  inboxOpen: boolean;
  onToggleInbox: () => void;
  creating: boolean;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  /** Fired after a create or an approved draft — the caller refetches. */
  onChanged: () => void;
}

/**
 * `PersonaLayout.topSlot` for the master view: the status filter + create door,
 * the collapsible draft inbox, and the inline create form. Extracted so the
 * tab file stays a composition rather than a render tree.
 */
export function CharterMasterHeader({
  personaId,
  counts,
  statusFilter,
  onStatusFilter,
  inboxOpen,
  onToggleInbox,
  creating,
  onStartCreate,
  onCancelCreate,
  onChanged,
}: CharterMasterHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <CharterToolbar
        counts={counts}
        statusFilter={statusFilter}
        onStatusFilter={onStatusFilter}
        inboxOpen={inboxOpen}
        onToggleInbox={onToggleInbox}
        onNew={onStartCreate}
      />
      {inboxOpen && personaId ? (
        <CharterDraftInbox personaId={personaId} onApplied={onChanged} />
      ) : null}
      {creating ? (
        <SectionCard title={t.agents.life.resp_new}>
          <CharterEditor
            personaId={personaId}
            onSaved={() => {
              onCancelCreate();
              onChanged();
            }}
            onCancel={onCancelCreate}
          />
        </SectionCard>
      ) : null}
    </div>
  );
}
