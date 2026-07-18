import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { usePersonaNameMap } from '@/hooks/usePersonaNameMap';
import { Button, AsyncButton } from '@/features/shared/components/buttons';

/**
 * Orphan-deployment reconcile surface.
 *
 * On (re)connect the cloud slice diffs the orchestrator's live deployments
 * against this install's local audit trail; any deployment still running with
 * no local record (a leftover from a previous session / another machine, still
 * billing) is surfaced here. READ-ONLY until the user acts: they adopt (keep +
 * record locally) or undeploy (shut down) each one, or dismiss the whole banner.
 */
export function CloudReconcileBanner() {
  const { t, tx } = useTranslation();
  const r = t.deployment.reconcile;
  const personaName = usePersonaNameMap();
  const orphans = useSystemStore((s) => s.cloudOrphanDeployments);
  const adopt = useSystemStore((s) => s.cloudAdoptOrphan);
  const undeploy = useSystemStore((s) => s.cloudUndeployOrphan);
  const dismiss = useSystemStore((s) => s.cloudDismissReconcile);

  if (orphans.length === 0) return null;

  const summary = orphans.length === 1 ? r.summary_one : r.summary_other;

  return (
    <div
      data-testid="cloud-reconcile-banner"
      role="alert"
      className="rounded-card border border-amber-500/30 bg-amber-500/10 p-4 space-y-3"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-1">
          <p className="typo-body font-medium text-foreground">{r.heading}</p>
          <p className="typo-body text-foreground">
            {tx(summary, { count: orphans.length })}
          </p>
          <p className="typo-caption text-foreground">{r.explain}</p>
        </div>
        <Button variant="ghost" size="xs" onClick={dismiss} data-testid="cloud-reconcile-dismiss">
          {r.dismiss}
        </Button>
      </div>

      <ul className="space-y-2">
        {orphans.map((d) => (
          <li
            key={d.id}
            data-testid={`cloud-reconcile-item-${d.id}`}
            className="flex items-center gap-2 rounded-input bg-secondary/40 px-3 py-2"
          >
            <div className="flex-1 min-w-0">
              <p className="typo-body text-foreground truncate">
                {personaName(d.personaId) || d.label || r.unknown_persona}
              </p>
              <p className="typo-caption text-foreground truncate">{d.slug}</p>
            </div>
            <AsyncButton
              variant="secondary"
              size="xs"
              title={r.adopt_title}
              onClick={() => adopt(d.id)}
              data-testid={`cloud-reconcile-adopt-${d.id}`}
            >
              {r.adopt}
            </AsyncButton>
            <AsyncButton
              variant="danger"
              size="xs"
              title={r.undeploy_title}
              onClick={() => undeploy(d.id)}
              data-testid={`cloud-reconcile-undeploy-${d.id}`}
            >
              {r.undeploy}
            </AsyncButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
