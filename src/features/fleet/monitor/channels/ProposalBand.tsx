import { memo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { memberColor } from '@/lib/channel/eventModel';
import { Engraved, Lamp } from '../grid/prototype/entry-e/parts';
import type { AssignProposal } from './conversationModel';

/**
 * PROPOSAL BAND - the composer's routed goal, waiting on Run it / Drop (WP12).
 * An `ae-win` lit info while it waits: the eyebrow says how many steps were
 * routed, the goal is the title, each step a numbered row with who takes it
 * (or "unrouted"). memo: the callbacks are keyed (they take the proposal / its
 * goal), so a poll re-renders nothing here.
 */
export const ProposalBand = memo(function ProposalBand({ proposal, onConfirm, onDismiss }: {
  proposal: AssignProposal;
  onConfirm: (proposal: AssignProposal) => void;
  onDismiss: (goal: string) => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const personaIndex = usePersonaIndex();
  const [open, setOpen] = useState(true);
  const pending = proposal.status === 'pending';

  return (
    <div className={`ae-win ae-t-info my-2 overflow-hidden rounded-card px-3 py-2 ${pending ? 'is-lit' : ''}`} data-testid="conv-proposal">
      <div className="flex items-center gap-2">
        <Lamp lamp={{ tone: 'info', lit: pending }} />
        <Engraved className="min-w-0 flex-1 truncate">
          {proposal.status === 'launched' ? m.conv_proposal_running : tx(m.conv_proposal_steps, { count: proposal.steps.length })}
        </Engraved>
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={proposal.goal}>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </Button>
      </div>
      <span className="mt-0.5 block typo-heading text-foreground">{proposal.goal}</span>
      {open && (
        <div className="mt-1.5 space-y-1">
          {proposal.steps.map((s, i) => {
            const persona = s.suggestedPersonaId ? personaIndex.get(s.suggestedPersonaId) : undefined;
            return (
              <div key={i} className="grid grid-cols-[1.25rem_1fr_auto] items-baseline gap-x-2">
                <span className="typo-data tabular-nums text-foreground">{i + 1}</span>
                <span className="min-w-0 truncate typo-body text-foreground">{s.title}</span>
                {persona ? (
                  <span className="typo-caption" style={{ color: memberColor(persona, s.suggestedPersonaId) }}>{persona.name.replace(/^T:\s*/, '')}</span>
                ) : (
                  <span className="typo-caption text-status-warning">{m.conv_unrouted}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {pending && (
        <div className="mt-2 flex gap-1.5">
          <Button variant="accent" tone="success" size="xs" icon={<Check className="h-3 w-3" aria-hidden />} onClick={() => onConfirm(proposal)}>
            {m.conv_proposal_run}
          </Button>
          <Button variant="ghost" size="xs" icon={<X className="h-3 w-3" aria-hidden />} onClick={() => onDismiss(proposal.goal)}>
            {m.conv_proposal_drop}
          </Button>
        </div>
      )}
    </div>
  );
});
