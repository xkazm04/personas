// Monitoring dimension — the modal behind the passport's Monitoring cell.
// Consolidated 2026-08-06: the prototype switcher and every losing variant are
// gone; `MonitoringConsole` is the sole body (see its header comment for the
// layout doctrine — readings in the header, capability cards in the grid, this
// project's deployment actions in the commit row).
//
// This file owns the WIRING only: the four capability rows (monitoringModel),
// their bindings from the per-environment connector table, and the two Claude
// dispatches — the integration deploy for a NOT_IMPLEMENTED card, and the
// per-card focused scan.
//
// The Upgrade lane is gone because its content is dissolved into the console's
// chrome; the fleet-wide "queue for all N projects" deliberately did NOT come
// along — this modal is one project's cockpit, and the batch stays in the wall
// popover (ImproveClassicPanel).
import { useCallback, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useImproveActivityStore } from '@/stores/improveActivityStore';
import { useTranslation } from '@/i18n/useTranslation';

import type { AppPassport } from '../passportModel';
import { useImprove } from './ImproveContext';
import { bindingKey, useEnvConnectors } from './envConnectors';
import { MONITORING_DIMENSION } from './improveRows';
import {
  areaScanPrompt, integrationPrompt, MONITORING_ENV, MONITORING_ITEMS, monitoringState,
} from './monitoringModel';
import type { MonitoringRow } from './monitoringTypes';
import { MonitoringConsole } from './MonitoringConsole';

/** The passport row whose golden-standard actions, level ladder and provenance
 *  describe this dimension. NOT `monitoring` — the deploy action is keyed
 *  `row: 'observability'` and LADDERS has only an `observability` entry; the
 *  round-3 lane pointed at `monitoring` and rendered nothing. */
const UPGRADE_ROW = 'observability';

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
  const [deploying, setDeploying] = useState<string | null>(null);
  const [areaScanning, setAreaScanning] = useState<string | null>(null);

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
        useImproveActivityStore.getState().start(`${slug}:${MONITORING_DIMENSION}`, taskId, 'deploy');
        addToast(d.monitoring_deploy_started, 'success');
      } catch (err) {
        toastCatch('monitoring deploy')(err);
      } finally {
        setDeploying(null);
      }
    })();
  }, [engine, slug, addToast, d]);

  /** The per-card focused scan — a Dev-runner session specialized to ONE
   *  capability area, so it audits logs OR metrics instead of grazing all four. */
  const onAreaScan = useCallback((row: MonitoringRow) => {
    if (!engine) return;
    const label = d[`monitoring_item_${row.def.labelKey}`];
    setAreaScanning(row.def.key);
    void (async () => {
      try {
        const taskId = await engine.deployNow(
          slug,
          `Focused scan: ${label}`,
          areaScanPrompt(label, row.detected, row.bound?.name ?? null),
        );
        useImproveActivityStore.getState().start(`${slug}:${MONITORING_DIMENSION}`, taskId, 'deploy');
        addToast(d.monitoring_area_scan_started, 'success');
      } catch (err) {
        toastCatch('monitoring area scan')(err);
      } finally {
        setAreaScanning(null);
      }
    })();
  }, [engine, slug, addToast, d]);

  return (
    <BaseModal isOpen onClose={onClose} titleId="monitoring-modal-title" size="6xl" portal staggerChildren={false}>
      <div className="flex flex-col h-[calc(100dvh-160px)] min-h-[520px] max-h-[760px]" data-testid="monitoring-modal">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04] flex-shrink-0">
          <Activity className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <span id="monitoring-modal-title" className="typo-title truncate">{d.monitoring_modal_title}</span>
          <span className="typo-caption text-foreground/60 truncate" style={{ fontWeight: 400 }}>· {projectName}</span>
        </div>

        <MonitoringConsole
          rows={rows}
          busyKey={env.saving?.split('|')[0] ?? null}
          deploying={deploying}
          onAssign={onAssign}
          onDeploy={onDeploy}
          slug={slug}
          upgradeRow={UPGRADE_ROW}
          onDone={onClose}
          areaScanning={areaScanning}
          onAreaScan={onAreaScan}
        />
      </div>
    </BaseModal>
  );
}
