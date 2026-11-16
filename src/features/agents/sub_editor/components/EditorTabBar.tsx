import { FileText, Settings, FlaskConical, Activity, Wand2, HeartPulse } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import type { EditorTab } from '@/lib/types/types';
import { isTabDirty } from '../libs/editorTabConstants';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useTier } from '@/hooks/utility/interaction/useTier';
import type { Tier } from '@/lib/constants/uiModes';
import { TIERS } from '@/lib/constants/uiModes';
import { useTranslation } from '@/i18n/useTranslation';
import { useHealthCheck } from '@/features/agents/sub_health';
import Button from '@/features/shared/components/buttons/Button';

type TabDefBase = { id: EditorTab; labelKey: string; icon: typeof FileText; minTier?: Tier };
const tabDefs: TabDefBase[] = [
  { id: 'activity', labelKey: 'tab_activity', icon: Activity, minTier: TIERS.TEAM },
  { id: 'design', labelKey: 'tab_design', icon: Wand2 },
  { id: 'lab', labelKey: 'tab_lab', icon: FlaskConical, minTier: TIERS.TEAM },
  { id: 'settings', labelKey: 'tab_settings', icon: Settings },
];

interface EditorTabBarProps {
  dirtyTabs: string[];
  connectorsMissing: number;
  /** Tabs whose last save attempt failed — shown with an error badge so the
   *  user can see exactly which tab to recover. */
  failedTabs?: string[];
}

type TabBadgeVariant = 'dirty' | 'error';

/** `srLabel` is the badge's meaning for assistive tech: the dot and the `!`
 *  are colour and shape only, so without it a screen reader heard nothing
 *  (or a bare punctuation mark) where a sighted user saw "unsaved". */
function TabBadge({ variant, count, srLabel }: { variant: TabBadgeVariant; count?: number; srLabel?: string }) {
  const sr = srLabel ? <span className="sr-only">{srLabel}</span> : null;
  if (variant === 'error') {
    return (
      <span className="ml-auto min-w-4 text-status-error typo-data text-center">
        {count ?? '!'}{sr}
      </span>
    );
  }
  return <span className="ml-auto w-1.5 h-1.5 rounded-full bg-status-warning">{sr}</span>;
}

const GRADE_TONE: Record<'healthy' | 'degraded' | 'unhealthy', string> = {
  healthy:   'text-status-success',
  degraded:  'text-status-warning',
  unhealthy: 'text-status-error',
};

function HealthBadge() {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const health = useHealthCheck();
  const labels = t.agents.editor_ui;
  const running = health.phase === 'running';
  const failed = health.phase === 'error';
  const score = health.score;
  // A failed run used to fall through to the neutral "never checked" label, so
  // pressing the badge and having the check throw looked identical to never
  // having pressed it. Surface the failure in its own tone instead.
  const badgeTone = failed
    ? GRADE_TONE.unhealthy
    : score
      ? GRADE_TONE[score.grade]
      : 'text-ink-2';
  const badgeLabel = running
    ? labels.design_health_checking
    : failed
      ? t.agents.health_check.check_failed
      : score
        ? `${labels[`design_health_${score.grade}` as const] ?? score.grade} · ${score.value}`
        : labels.design_health_never_checked;
  return (
    <Button
      variant="secondary"
      size="sm"
      tooltip={labels.design_health_run}
      onClick={() => selectedPersona && health.runHealthCheck(selectedPersona)}
      disabled={running || !selectedPersona}
      data-testid="editor-health-badge"
      className={`whitespace-nowrap ${badgeTone}`}
      icon={<HeartPulse className="w-3.5 h-3.5" />}
    >
      <span className="num">{badgeLabel}</span>
    </Button>
  );
}

export function EditorTabBar({ dirtyTabs, connectorsMissing, failedTabs = [] }: EditorTabBarProps) {
  const { t, tx } = useTranslation();
  const editorTab = useSystemStore((s) => s.editorTab);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const tier = useTier();
  const editorLabels = t.agents.editor_ui;
  return (
    <div className="border-b border-hair bg-surface-1">
      <div className={`flex items-center ${IS_MOBILE ? 'px-1' : 'px-6'}`}>
        <div className={`flex overflow-x-auto flex-1 min-w-0 ${IS_MOBILE ? 'gap-0' : 'gap-1'} scrollbar-none`}>
          {tabDefs.filter((td) => !td.minTier || tier.isVisible(td.minTier)).map((tab) => {
            const Icon = tab.icon;
            const isActive = editorTab === tab.id;
            const tabDirty = isTabDirty(tab.id, dirtyTabs);
            const label = (editorLabels as Record<string, string>)[tab.labelKey] ?? tab.labelKey;
            return (
              <Button
                key={tab.id}
                tooltip={label}
                variant="ghost"
                size="md"
                pressed={isActive}
                onClick={() => setEditorTab(tab.id)}
                data-testid={`editor-tab-${tab.id}`}
                // On mobile the visible label is hidden, and a title is not a
                // reliable accessible name on touch devices.
                aria-label={IS_MOBILE ? label : undefined}
                className="whitespace-nowrap"
                icon={<Icon className="w-4 h-4" />}
              >
                {!IS_MOBILE && label}
                {failedTabs.includes(tab.id)
                  ? <TabBadge variant="error" srLabel={editorLabels.tab_save_failed_indicator} />
                  : tab.id === 'design' && connectorsMissing > 0
                    ? (
                      <TabBadge
                        variant="error"
                        count={connectorsMissing}
                        srLabel={tx(editorLabels.missing_credentials, { credentials: String(connectorsMissing) })}
                      />
                    )
                    : tabDirty
                      ? <TabBadge variant="dirty" srLabel={editorLabels.unsaved_changes} />
                      : null}
              </Button>
            );
          })}
        </div>
        {!IS_MOBILE && (
          <div className="pl-3 flex-shrink-0">
            <HealthBadge />
          </div>
        )}
      </div>
    </div>
  );
}
