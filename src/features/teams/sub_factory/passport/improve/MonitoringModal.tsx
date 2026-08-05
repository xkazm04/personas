// Monitoring dimension — the modal behind the passport's Monitoring cell.
//
// Owns the wiring only: the four capability rows (see monitoringModel), their
// bindings from the per-environment connector table, the vault candidates, and
// the Claude deployment a NOT_IMPLEMENTED item dispatches. Shape follows
// SkillsWorkbench / DatabaseModal — BaseModal, header band, fixed body height,
// footer strip.
//
// PROTOTYPE SCAFFOLD: the `variant` state + the SegmentedTabs in the header are
// throwaway; consolidation deletes them and the loser file.
import { useCallback, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { BaseModal } from '@/features/shared/components/modals';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useImproveActivityStore } from '@/stores/improveActivityStore';
import { useTranslation } from '@/i18n/useTranslation';

import type { AppPassport } from '../passportModel';
import { useImprove } from './ImproveContext';
import { bindingKey, useEnvConnectors } from './envConnectors';
import {
  integrationPrompt, MONITORING_ENV, MONITORING_ITEMS, monitoringState,
} from './monitoringModel';
import type { MonitoringRow } from './monitoringTypes';
import { MonitoringConsoleVariant } from './MonitoringConsoleVariant';
import { MonitoringPipelineVariant } from './MonitoringPipelineVariant';

type Variant = 'console' | 'pipeline';

/** Union of every service type any item accepts — one vault fetch covers all
 *  four rows; each row filters the result to its own accepted types. */
const ALL_SERVICE_TYPES = [...new Set(MONITORING_ITEMS.flatMap((i) => i.serviceTypes))];

export function MonitoringModal({ slug, projectName, passport, onClose }: {
  slug: string;
  projectName: string;
  passport: AppPassport;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const env = useEnvConnectors(slug, ALL_SERVICE_TYPES);
  const [variant, setVariant] = useState<Variant>('console');
  const [selected, setSelected] = useState<string | null>(null);
  const [deploying, setDeploying] = useState<string | null>(null);

  const rows = useMemo<MonitoringRow[]>(() => MONITORING_ITEMS.map((def) => {
    const boundId = env.bindings.get(bindingKey(def.key, MONITORING_ENV));
    const detected = def.detected(passport);
    const accepted = new Set(def.serviceTypes);
    return {
      def,
      detected,
      bound: env.credentialById(boundId),
      state: monitoringState(detected, Boolean(boundId)),
      candidates: env.credentials.filter((c) => accepted.has(c.serviceType.toLowerCase())),
      health: env.health,
    };
  }), [env, passport]);

  const onAssign = useCallback((itemKey: string, credentialId: string | null) => {
    void env.assign(itemKey, MONITORING_ENV, credentialId).catch(toastCatch('monitoring assign'));
  }, [env]);

  /** NOT_IMPLEMENTED → a Dev-runner task that reads the wiring and writes the
   *  integration. Locks the passport's monitoring cell like every other deploy,
   *  so the wall shows the run in flight. */
  const onDeploy = useCallback((row: MonitoringRow) => {
    if (!engine || !row.bound) return;
    const label = d[`monitoring_item_${row.def.labelKey}`];
    setDeploying(row.def.key);
    void (async () => {
      try {
        const taskId = await engine.deployNow(
          slug,
          `Wire ${label} (${row.bound!.serviceType})`,
          integrationPrompt(label, row.bound!.name, row.bound!.serviceType),
        );
        useImproveActivityStore.getState().start(`${slug}:monitoring`, taskId, 'deploy');
        addToast(d.monitoring_deploy_started, 'success');
      } catch (err) {
        toastCatch('monitoring deploy')(err);
      } finally {
        setDeploying(null);
      }
    })();
  }, [engine, slug, addToast, d]);

  const shared = { rows, busyKey: env.saving?.split('|')[0] ?? null, deploying, onAssign, onDeploy };

  return (
    <BaseModal isOpen onClose={onClose} titleId="monitoring-modal-title" size="lg" portal staggerChildren={false}>
      <div className="flex flex-col h-[460px]" data-testid="monitoring-modal">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04] flex-shrink-0">
          <Activity className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <span id="monitoring-modal-title" className="typo-title truncate">{d.monitoring_modal_title}</span>
          <span className="typo-caption text-foreground/70 truncate">· {projectName}</span>
          {/* PROTOTYPE ONLY — removed on consolidation. */}
          <span className="ml-auto shrink-0">
            <SegmentedTabs
              tabs={[{ id: 'console', label: 'A · Console' }, { id: 'pipeline', label: 'B · Pipeline' }]}
              activeTab={variant}
              onTabChange={(v) => setVariant(v as Variant)}
              variant="pill"
              size="sm"
              fullWidth={false}
              ariaLabel="Prototype variant"
            />
          </span>
        </div>

        {variant === 'console'
          ? <MonitoringConsoleVariant {...shared} />
          : <MonitoringPipelineVariant {...shared} selected={selected} onSelect={setSelected} />}

        <div className="px-4 py-2 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
          <span className="typo-label text-foreground/35">{d.monitoring_modal_footer}</span>
        </div>
      </div>
    </BaseModal>
  );
}
