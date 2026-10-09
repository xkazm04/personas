import { ListChecks, X, CircleCheck, CircleX, Loader2, CircleDashed } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAthenaStore, type AthenaAssignmentRef } from './athenaStore';
import { useSystemStore } from '@/stores/systemStore';

/** Compact strip of Athena-dispatched team assignments. Renders above
 *  the chat messages list when at least one card is present; hidden
 *  otherwise. Clicking a card routes to Projects, where the team workspace
 *  holds the assignment. */
export function AthenaAssignmentCards() {
  const { t } = useTranslation();
  const cards = useAthenaStore((s) => s.athenaAssignments);
  const dismiss = useAthenaStore((s) => s.dismissAthenaAssignment);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  if (cards.length === 0) return null;

  const handleOpen = (_ref: AthenaAssignmentRef) => {
    // `'pipeline'` is not a SidebarSection and never was: the cast named no
    // vocabulary, so the compiler could not say so, and the value crashed the
    // shell on the next launch because `sidebarSection` is persisted (see the
    // membership guard in systemStore's rehydrate). Projects is the section
    // whose team workspace actually holds an assignment. Deep-linking to a
    // specific assignment inside the canvas is still a Phase C4 polish.
    setSidebarSection('teams');
  };

  return (
    <div className="border-b border-primary/10 px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5 typo-caption text-foreground">
        <ListChecks className="w-3.5 h-3.5 text-status-processing" />
        {t.athena.athena_assignments_title}
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
      ? 'text-status-success'
      : card.status === 'failed' || card.status === 'aborted' || card.failedSteps > 0
        ? 'text-status-error'
        : card.status === 'running'
          ? 'text-status-processing'
          : 'text-status-neutral';
  const spin = card.status === 'running' || card.status === 'queued';

  // A container with two sibling buttons: nesting the dismiss control inside
  // the open button is invalid DOM (React logs validateDOMNesting) and makes
  // the inner control unreachable for assistive tech.
  return (
    <div
      data-testid={`athena-assignment-card-${card.assignmentId}`}
      className="group relative flex items-start rounded-card border border-primary/10 hover:border-primary/30 hover:bg-secondary/30 focus-within:border-primary/30 transition-colors"
    >
      <button
        type="button"
        onClick={onOpen}
        data-testid="athena-assignment-open"
        className="focus-ring flex-1 min-w-0 flex items-start gap-2 pl-2 pr-8 py-1.5 rounded-card text-left"
      >
        <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${color} ${spin ? 'animate-spin' : ''}`} />
        <span className="flex-1 min-w-0">
          <span className="block typo-caption text-foreground truncate">{card.title}</span>
          <span className="block typo-caption text-foreground truncate">
            {card.doneSteps}/{card.totalSteps} steps
            {card.failedSteps > 0 ? ` · ${card.failedSteps} failed` : ''}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        data-testid="athena-assignment-dismiss"
        className="focus-ring absolute right-1 top-1 p-1 rounded-interactive text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-primary/10"
        aria-label={t.common.dismiss}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
