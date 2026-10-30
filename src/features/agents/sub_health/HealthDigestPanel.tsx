import { useShallow } from 'zustand/react/shallow';
import { RefreshCw } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { KitHost, ListRow, Rows } from '@/features/shared/components/kit';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { attentionChecks, needsAttention } from './healthScoring';
import type { PersonaHealthCheck } from './types';

function openAgent(personaId: string) {
  useSystemStore.getState().setSidebarSection('personas');
  useAgentStore.getState().selectPersona(personaId);
}

/**
 * The weekly digest's drill-down: the score and issue count the notification
 * carries, then every agent that needs attention (worst first) with its issues,
 * each row opening that agent. The notification is the door; this is the room.
 * It reads the digest the scheduler (or "Run Health Digest" here) stored on the
 * agent store this session.
 */
export function HealthDigestPanel() {
  const { t, tx } = useTranslation();
  const d = t.agents.health_digest;
  const { digest, running, run } = useAgentStore(useShallow((s) => ({
    digest: s.healthDigest,
    running: s.healthDigestRunning,
    run: s.runFullHealthDigest,
  })));

  const rows = digest ? attentionChecks(digest.personas) : [];

  const summary = digest
    ? tx(d.panel_summary, {
      score: digest.totalScore.value,
      issues: tx(digest.totalIssues === 1 ? d.issues_one : d.issues_other, { count: digest.totalIssues }),
      agents: tx(digest.personas.length === 1 ? d.agents_checked_one : d.agents_checked_other, { count: digest.personas.length }),
    })
    : d.panel_never_run;

  const issueLine = (check: PersonaHealthCheck) => {
    const items = check.result.issues.filter(needsAttention);
    const first = items[0]?.description ?? '';
    return items.length > 1 ? tx(d.panel_more_issues, { first, count: items.length - 1 }) : first;
  };

  return (
    <div className="mt-4 space-y-3" data-testid="health-digest-panel">
      <div className="flex items-center justify-between gap-3">
        <p className="typo-body text-foreground" data-testid="health-digest-summary">{summary}</p>
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          loading={running}
          loadingLabel={d.generating}
          onClick={() => void run()}
          data-testid="health-digest-run"
        >
          {d.run_digest}
        </Button>
      </div>
      {digest && (
        <KitHost>
          <Rows count={rows.length} empty={{ title: d.all_healthy, tone: 'success' }} label={d.group_attention}>
            {rows.map((check) => {
              const blocked = check.result.status === 'blocked';
              return (
                <ListRow
                  key={check.personaId}
                  name={check.personaName}
                  meta={issueLine(check)}
                  mark={{ tone: blocked ? 'error' : 'warning', label: blocked ? d.group_blocked : d.group_attention }}
                  onPress={() => openAgent(check.personaId)}
                  testId={`health-digest-row-${check.personaId}`}
                />
              );
            })}
          </Rows>
        </KitHost>
      )}
    </div>
  );
}
