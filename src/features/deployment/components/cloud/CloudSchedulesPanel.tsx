import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Plus } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { Button } from '@/features/shared/components/buttons';
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

interface Props {
  deployments: CloudDeployment[];
  onRefresh: () => void;
}

export function CloudSchedulesPanel({ deployments, onRefresh }: Props) {
  const personas = usePersonaStore((s) => s.personas);

  const [triggers, setTriggers] = useState<CloudTrigger[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [firings, setFirings] = useState<CloudTriggerFiring[]>([]);
  const [isLoadingFirings, setIsLoadingFirings] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const deployedPersonaIds = useMemo(
    () => new Set(deployments.filter((d) => d.status === 'active').map((d) => d.persona_id)),
    [deployments],
  );

  const deployedPersonas = useMemo(
    () => personas.filter((p) => deployedPersonaIds.has(p.id)),
    [personas, deployedPersonaIds],
  );

  const personaName = useCallback(
    (id: string) => personas.find((p) => p.id === id)?.name ?? id.slice(0, 8),
    [personas],
  );

  const fetchTriggers = useCallback(async () => {
    if (deployedPersonaIds.size === 0) {
      setTriggers([]);
      return;
    }
    setIsLoading(true);
    try {
      const results = await Promise.all(
        Array.from(deployedPersonaIds).map((pid) => cloudListTriggers(pid).catch(() => [] as CloudTrigger[])),
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
    setIsLoadingFirings(true);
    cloudListTriggerFirings(expandedId, 10)
      .then(setFirings)
      .catch(() => setFirings([]))
      .finally(() => setIsLoadingFirings(false));
  }, [expandedId]);

  const handleToggle = async (trigger: CloudTrigger) => {
    await cloudUpdateTrigger(trigger.id, undefined, undefined, !trigger.enabled);
    await fetchTriggers();
  };

  const handleDelete = async (triggerId: string) => {
    await cloudDeleteTrigger(triggerId);
    if (expandedId === triggerId) setExpandedId(null);
    await fetchTriggers();
  };

  const handleCreated = async () => {
    setShowCreate(false);
    await fetchTriggers();
  };

  return (
    <div className={DEPLOYMENT_TOKENS.panelSpacing}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground/90 uppercase tracking-wider">
          Cloud Triggers ({triggers.length})
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowCreate(!showCreate)}
            accentColor="indigo"
          >
            Add Trigger
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}
            onClick={() => { fetchTriggers(); onRefresh(); }}
            disabled={isLoading}
          >
            Refresh
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

      {/* No deployments notice */}
      {deployments.filter((d) => d.status === 'active').length === 0 && (
        <p className="text-sm text-muted-foreground/60 py-6 text-center">
          Deploy a persona first to create cloud triggers.
        </p>
      )}

      {/* Trigger list */}
      {triggers.length === 0 && deployedPersonaIds.size > 0 ? (
        <p className="text-sm text-muted-foreground/60 py-6 text-center">
          {isLoading ? 'Loading triggers...' : 'No cloud triggers yet. Create one to schedule automated runs.'}
        </p>
      ) : (
        <div className="space-y-1">
          {triggers.map((trigger) => (
            <TriggerListItem
              key={trigger.id}
              trigger={trigger}
              isExpanded={expandedId === trigger.id}
              firings={expandedId === trigger.id ? firings : []}
              isLoadingFirings={expandedId === trigger.id && isLoadingFirings}
              personaName={personaName(trigger.persona_id)}
              onToggleExpand={() => setExpandedId(expandedId === trigger.id ? null : trigger.id)}
              onToggleEnabled={() => handleToggle(trigger)}
              onDelete={() => handleDelete(trigger.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
