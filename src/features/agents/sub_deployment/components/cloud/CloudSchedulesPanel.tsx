import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { RefreshCw, Plus } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { usePersonaNameMap } from "@/hooks/usePersonaNameMap";
import { Button } from '@/features/shared/components/buttons';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import {
  cloudListTriggers,
  cloudUpdateTrigger,
  cloudDeleteTrigger,
  cloudListTriggerFirings,
} from '@/api/system/cloud';
import type { CloudTrigger, CloudTriggerFiring, CloudDeployment } from '@/api/system/cloud';
import { DEPLOYMENT_TOKENS } from '../deploymentTokens';
import { CreateTriggerForm } from './CreateTriggerForm';
import { TriggerListItem } from './TriggerListItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

interface Props {
  deployments: CloudDeployment[];
  /** True while the parent's deployments list is still being fetched — used
   * only to avoid flashing "deploy first" before we actually know. */
  isFetchingDeployments?: boolean;
  onRefresh: () => void;
}

const TRIGGER_CASCADE_ROWS = 14;

export function CloudSchedulesPanel({ deployments, isFetchingDeployments = false, onRefresh }: Props) {
  const { t } = useTranslation();
  const ds = t.deployment.schedules;
  const personas = useAgentStore((s) => s.personas);
  const personaName = usePersonaNameMap();

  const [triggers, setTriggers] = useState<CloudTrigger[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [firings, setFirings] = useState<CloudTriggerFiring[]>([]);
  const [isLoadingFirings, setIsLoadingFirings] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const deployedPersonaIds = useMemo(
    () => new Set(deployments.filter((d) => d.status === 'active').map((d) => d.personaId)),
    [deployments],
  );

  const deployedPersonas = useMemo(
    () => personas.filter((p) => deployedPersonaIds.has(p.id)),
    [personas, deployedPersonaIds],
  );

  const fetchTriggers = useCallback(async () => {
    if (deployedPersonaIds.size === 0) {
      setTriggers([]);
      return;
    }
    setIsLoading(true);
    try {
      const results = await Promise.all(
        Array.from(deployedPersonaIds).map((pid) => cloudListTriggers(pid).catch((err) => { silentCatch('CloudSchedulesPanel:cloudListTriggers')(err); return [] as CloudTrigger[]; })),
      );
      setTriggers(results.flat());
    } finally {
      setIsLoading(false);
    }
  }, [deployedPersonaIds]);

  useEffect(() => { fetchTriggers(); }, [fetchTriggers]);

  useEffect(() => {
    if (!expandedId) {
      setFirings([]);
      return;
    }
    let cancelled = false;
    setIsLoadingFirings(true);
    cloudListTriggerFirings(expandedId, 10)
      .then((data) => { if (!cancelled) setFirings(data); })
      .catch((err) => { silentCatch('CloudSchedulesPanel:cloudListTriggerFirings')(err); if (!cancelled) setFirings([]); })
      .finally(() => { if (!cancelled) setIsLoadingFirings(false); });
    return () => { cancelled = true; };
  }, [expandedId]);

  // Both are remote writes against the orchestrator. A rejection used to
  // surface only as an unhandled promise: no toast, the row unchanged, and
  // nothing to tell the user the click did not land. The toast renderer
  // classifies the raw error into the registry's friendly copy.
  const handleToggle = async (trigger: CloudTrigger) => {
    try {
      await cloudUpdateTrigger(trigger.id, undefined, undefined, !trigger.enabled);
      await fetchTriggers();
    } catch (err) { toastCatch('CloudSchedulesPanel:toggle')(err); }
  };

  const handleDelete = async (triggerId: string) => {
    try {
      await cloudDeleteTrigger(triggerId);
      if (expandedId === triggerId) setExpandedId(null);
      await fetchTriggers();
    } catch (err) { toastCatch('CloudSchedulesPanel:delete')(err); }
  };

  const handleCreated = async () => {
    setShowCreate(false);
    await fetchTriggers();
  };

  // Ghosts only into cold emptiness while EITHER the parent deployments list
  // or our own trigger fetch is running; settled-only empty/notice states
  // (docs/design/overview-loading.md).
  const triggersFetching = isFetchingDeployments || isLoading;
  const showGhost = triggersFetching && triggers.length === 0;
  const enter = useRevealTracker('cloud-schedules');

  return (
    <div className={DEPLOYMENT_TOKENS.panelSpacing}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <SectionHeading className="typo-caption">{ds.header.replace('{count}', String(triggers.length))}</SectionHeading>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowCreate(!showCreate)}
            accentColor="indigo"
          >
            {ds.add_trigger}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}
            onClick={() => { fetchTriggers(); onRefresh(); }}
            disabled={isLoading}
          >
            {t.common.refresh}
          </Button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateTriggerForm
          deployedPersonas={deployedPersonas}
          onCreated={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* No deployments notice — settled-only, never flashes while the
          parent deployments list is still fetching. */}
      {!isFetchingDeployments && deployments.filter((d) => d.status === 'active').length === 0 && (
        <p className="typo-body text-foreground py-6 text-center">
          {ds.deploy_first}
        </p>
      )}

      {/* Trigger list */}
      {showGhost ? (
        <TriggerListGhosts />
      ) : triggers.length === 0 && deployedPersonaIds.size > 0 ? (
        <p className="typo-body text-foreground py-6 text-center">
          {ds.empty}
        </p>
      ) : (
        <div className="space-y-1">
          {triggers.map((trigger, index) => (
            // One-shot entrance cascade; rows past the first viewport render
            // plainly (folded into hasEntered); entered ids never replay.
            <RevealItem
              key={trigger.id}
              revealId={trigger.id}
              order={index}
              hasEntered={(id) => index >= TRIGGER_CASCADE_ROWS || enter.hasEntered(id)}
              markEntered={enter.markEntered}
            >
              <TriggerListItem
                trigger={trigger}
                isExpanded={expandedId === trigger.id}
                firings={expandedId === trigger.id ? firings : []}
                isLoadingFirings={expandedId === trigger.id && isLoadingFirings}
                personaName={personaName(trigger.personaId)}
                onToggleExpand={() => setExpandedId(expandedId === trigger.id ? null : trigger.id)}
                onToggleEnabled={() => handleToggle(trigger)}
                onDelete={() => handleDelete(trigger.id)}
              />
            </RevealItem>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TriggerListGhosts — calm placeholder rows for the ONLY moment the trigger
// list has nothing to show (deployments or triggers still fetching). Same
// row shape as `TriggerListItem`'s collapsed row. Delayed entrance (§C,
// docs/design/overview-loading.md); no `animate-pulse`.
// ---------------------------------------------------------------------------

function TriggerListGhosts() {
  return (
    <div aria-hidden="true" className="space-y-1">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-3 py-2 rounded-card bg-secondary/30 border border-primary/10 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <span className="w-3.5 h-3.5 rounded bg-primary/[0.06]" />
          <span className="h-3.5 flex-1 max-w-[10rem] rounded bg-primary/[0.06]" />
          <span className="h-5 w-14 rounded-card bg-primary/[0.06]" />
        </div>
      ))}
    </div>
  );
}
