import { useState } from 'react';
import { CheckCircle2, CornerDownRight, SkipForward, Wand2, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Branch } from '@/features/decision-center/deck/DeckDock';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import type { useTeamDeliberations } from '@/features/teams/sub_deliberations/useTeamDeliberations';
import type { TeamDeliberation } from '@/lib/bindings/TeamDeliberation';
import { Engraved, Lamp } from '../grid/prototype/entry-e/parts';
import type { DeliberationProposal } from './deliberationStatus';

/** A capability a persona asked to run, as the engine stores it on the row. */
export interface PendingAction { persona_id?: string; use_case_id?: string; rationale?: string }

type Hook = ReturnType<typeof useTeamDeliberations>;
const icon = (I: typeof Wand2) => <I className="h-4 w-4" aria-hidden />;

/** One decision block of the rail: a lamp-lit engraved head, its words, then its choices as deck branches. */
function Block({ tone, title, children }: { tone: 'warn' | 'ok'; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2"><Lamp lamp={{ tone, lit: tone === 'warn' }} /><Engraved>{title}</Engraved></span>
      {children}
    </div>
  );
}

/**
 * What a deliberation asks the OPERATOR to decide, each in the dock's grammar:
 * a gated capability (approve and run, or skip), an escalation (resume,
 * resolve or abort, with a note), and the converged proposal (turn it into an
 * assignment, or dismiss it). Shown only when the engine raised one.
 */
export function DeliberationDecisions({ d, detail, id, pending, proposal }: {
  d: Hook;
  detail: TeamDeliberation;
  id: string;
  pending: PendingAction | null;
  proposal: DeliberationProposal | null;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const personaIndex = usePersonaIndex();
  const [note, setNote] = useState('');
  const who = pending ? personaIndex.get(pending.persona_id ?? '')?.name.replace(/^T:\s*/, '') ?? pending.persona_id : null;

  return (
    <>
      {pending && (
        <Block tone="warn" title={m.delib_capability}>
          <p className="typo-body text-foreground">{who}{pending.rationale ? `: ${pending.rationale}` : ''}</p>
          <Branch label={m.delib_approve_run} accent icon={icon(CheckCircle2)} onClick={() => { if (!d.actionBusy) void d.approveAction(id); }} />
          <Branch label={m.delib_skip} icon={icon(SkipForward)} onClick={() => { if (!d.actionBusy) void d.skipAction(id); }} />
        </Block>
      )}
      {detail.status === 'escalated' && (
        <Block tone="warn" title={m.delib_escalated}>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={m.delib_decision_placeholder}
            aria-label={m.delib_decision_placeholder}
            className="au-well w-full resize-none rounded-input px-3 py-2 typo-body text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {(['resume', 'resolve', 'abort'] as const).map((verb) => (
            <Branch
              key={verb}
              label={verb === 'resume' ? m.delib_resume : verb === 'resolve' ? m.delib_resolve : m.delib_abort}
              accent={verb === 'resume'}
              icon={icon(verb === 'abort' ? X : CornerDownRight)}
              onClick={() => { if (!d.decisionBusy) void d.resolveEscalation(id, verb, note); }}
            />
          ))}
        </Block>
      )}
      {proposal?.title && (
        <Block tone="ok" title={m.delib_proposal}>
          <span className="typo-heading text-foreground">{proposal.title}</span>
          {proposal.summary && <p className="typo-body text-foreground">{proposal.summary}</p>}
          {detail.spawnedAssignmentId ? (
            <p className="typo-caption text-status-success">{m.delib_spawned}</p>
          ) : (
            <>
              <Branch label={m.delib_approve_run} accent icon={icon(Wand2)} onClick={() => void d.approve(id)} />
              <Branch label={m.delib_dismiss} icon={icon(X)} onClick={() => void d.dismiss(id)} />
            </>
          )}
        </Block>
      )}
    </>
  );
}
