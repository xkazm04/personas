import { ListChecks, X, CircleCheck, CircleX, Loader2, CircleDashed } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore, type AthenaAssignmentRef } from './companionStore';
import { useSystemStore } from '@/stores/systemStore';

/** Compact strip of Athena-dispatched team assignments. Renders above
 *  the chat messages list when at least one card is present; hidden
 *  otherwise. Clicking a card routes to the pipeline page so the user
 *  can see the full panel (composer + checklist). */
export function CompanionAssignmentCards() {
  const { t } = useTranslation();
  const cards = useCompanionStore((s) => s.athenaAssignments);
  const dismiss = useCompanionStore((s) => s.dismissAthenaAssignment);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  if (cards.length === 0) return null;

  const handleOpen = (_ref: AthenaAssignmentRef) => {
    // Route to the pipeline section where the AssignmentsPanel lives.
    // The panel auto-loads the team's assignments and the user can
    // expand the one they want. Deep-linking to a specific assignment
    // inside the canvas is a Phase C4 polish.
    setSidebarSection('pipeline' as Parameters<typeof setSidebarSection>[0]);
  };

  return (
    <div className="border-b border-primary/10 px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5 typo-caption font-medium text-foreground/70">
        <ListChecks className="w-3.5 h-3.5 text-orange-400" />
        {t.plugins.companion.athena_assignments_title}
      </div>
      {cards.map((card) => (
        <AssignmentCardRow
          key={card.assignmentId}
          card={card}
          onOpen={() => handleOpen(card)}
          onDismiss={() => dismiss(card.assignmentId)}
        />
      ))}
    </div>
  );
}

function AssignmentCardRow({
  card,
  onOpen,
  onDismiss,
}: {
  card: AthenaAssignmentRef;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const Icon =
    card.status === 'done'
      ? CircleCheck
      : card.status === 'failed' || card.status === 'aborted' || card.failedSteps > 0
        ? CircleX
        : card.status === 'running' || card.status === 'queued'
          ? Loader2
          : CircleDashed;
  const color =
    card.status === 'done'
      ? 'text-emerald-400'
      : card.status === 'failed' || card.status === 'aborted' || card.failedSteps > 0
        ? 'text-rose-400'
        : card.status === 'running'
          ? 'text-orange-400'
          : 'text-foreground/40';
  const spin = card.status === 'running' || card.status === 'queued';

  return (
    <button
      onClick={onOpen}
      className="group w-full flex items-start gap-2 px-2 py-1.5 rounded-card border border-primary/10 hover:border-orange-500/30 hover:bg-secondary/30 transition-colors text-left"
    >
      <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${color} ${spin ? 'animate-spin' : ''}`} />
      <div className="flex-1 min-w-0">
        <p className="typo-caption font-medium text-foreground/90 truncate">{card.title}</p>
        <p className="typo-caption text-foreground/50 truncate">
          {card.doneSteps}/{card.totalSteps} steps
          {card.failedSteps > 0 ? ` · ${card.failedSteps} failed` : ''}
        </p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-interactive hover:bg-primary/10 text-foreground/50"
        aria-label={t.common.dismiss}
      >
        <X className="w-3 h-3" />
      </button>
    </button>
  );
}
