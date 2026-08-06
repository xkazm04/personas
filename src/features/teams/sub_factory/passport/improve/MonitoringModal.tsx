// Monitoring dimension — the modal behind the passport's Monitoring cell.
//
// TWO LANES, the SkillsWorkbench arrangement:
//   · Capabilities — the four-item grid: bind a connector per capability, and
//     dispatch the integration for the one state that needs code.
//   · Upgrade      — `ImproveClassicPanel`, i.e. exactly what the old deploy
//     popover showed: "why this rating", the level ladder, the connector icon
//     grid, the golden-standard actions with prompt preview / Queue / Deploy
//     now, and "queue for all N projects that need this". None of it is
//     re-implemented here — the panel is the popover's own body, shared.
//
//     It reads the **observability** row, not `monitoring`. That is where every
//     one of those features is actually keyed: the deploy action is
//     `row: 'observability'`, and `LADDERS` has an `observability` entry and no
//     `monitoring` one. Pointing the lane at `monitoring` (the row this modal
//     opens from) therefore produced an EMPTY panel — and, because the tab was
//     gated on the panel having content, usually no tab at all. Same class of
//     bug as the canvas row-key mismatch: two names for one dimension.
//
// PROTOTYPE SCAFFOLD: the variant pill in the header is throwaway. It switches
// only the Capabilities lane; consolidation deletes it and the loser files.
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
import { hasClassicContent, ImproveClassicPanel } from './ImproveClassicPanel';
import { bindingKey, useEnvConnectors } from './envConnectors';
import { MONITORING_DIMENSION } from './improveRows';
import {
  integrationPrompt, MONITORING_ENV, MONITORING_ITEMS, monitoringState,
} from './monitoringModel';
import type { MonitoringRow } from './monitoringTypes';
import { MonitoringConsoleVariant } from './MonitoringConsoleVariant';
import { MonitoringConsoleV2Variant } from './MonitoringConsoleV2Variant';

type Lane = 'capabilities' | 'upgrade';
type Variant = 'console' | 'v2';

/** The passport row whose golden-standard actions, level ladder and provenance
 *  describe this dimension. See the note above: it is NOT `monitoring`. */
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
  const [lane, setLane] = useState<Lane>('capabilities');
  const [variant, setVariant] = useState<Variant>('console');
  const [deploying, setDeploying] = useState<string | null>(null);

  const classic = hasClassicContent(slug, UPGRADE_ROW, engine);

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

  const shared = { rows, busyKey: env.saving?.split('|')[0] ?? null, deploying, onAssign, onDeploy };

  return (
    <BaseModal isOpen onClose={onClose} titleId="monitoring-modal-title" size="6xl" portal staggerChildren={false}>
      {/* Viewport-relative like SkillsWorkbench. The tiles were ~370x195 in
          a 470px `lg` shell — too small to hold facts AND a picker, which is
          why every variant had to hide one to show the other. */}
      <div className="flex flex-col h-[calc(100dvh-160px)] min-h-[520px] max-h-[760px]" data-testid="monitoring-modal">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04] flex-shrink-0">
          <Activity className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <span id="monitoring-modal-title" className="typo-title truncate">{d.monitoring_modal_title}</span>
          <span className="typo-caption text-foreground/60 truncate" style={{ fontWeight: 400 }}>· {projectName}</span>
          <span className="ml-auto flex items-center gap-2 shrink-0">
            {/* PROTOTYPE ONLY — switches the Capabilities lane; removed on
                consolidation along with the two loser files. */}
            {(lane === 'capabilities' || variant === 'v2') && (
              <SegmentedTabs
                tabs={[
                  { id: 'console', label: 'A · Console' },
                  { id: 'v2', label: 'B · Console v2' },
                ]}
                activeTab={variant}
                onTabChange={(v) => setVariant(v as Variant)}
                variant="pill"
                size="sm"
                fullWidth={false}
                ariaLabel="Prototype variant"
              />
            )}
            {classic && variant === 'console' && (
              <SegmentedTabs
                tabs={[
                  { id: 'capabilities', label: d.monitoring_lane_capabilities },
                  { id: 'upgrade', label: d.monitoring_lane_upgrade },
                ]}
                activeTab={lane}
                onTabChange={(v) => setLane(v as Lane)}
                variant="segment"
                size="sm"
                fullWidth={false}
                ariaLabel={d.monitoring_lane_aria}
              />
            )}
          </span>
        </div>

        {lane === 'upgrade' && variant === 'console' ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <ImproveClassicPanel slug={slug} rowKey={UPGRADE_ROW} onDone={onClose} />
          </div>
        ) : variant === 'console' ? (
          <MonitoringConsoleVariant {...shared} />
        ) : (
          <MonitoringConsoleV2Variant {...shared} slug={slug} upgradeRow={UPGRADE_ROW} onDone={onClose} />
        )}

        <div className="px-4 py-2 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
          <span className="typo-caption text-foreground/45" style={{ fontWeight: 400 }}>{d.monitoring_modal_footer}</span>
        </div>
      </div>
    </BaseModal>
  );
}
