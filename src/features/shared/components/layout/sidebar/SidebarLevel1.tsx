import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { SidebarIconStyles, SIDEBAR_ICONS } from './SidebarIcons';
import { BadgeSlot, type BadgeDefinition } from './BadgeSlot';
import { OrbitDots } from './OrbitDots';
import { useSidebarAgentActivity } from '@/hooks/sidebar/useSidebarAgentActivity';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useBadgeCounts } from '@/hooks/sidebar/useBadgeCounts';
import type { SidebarSection } from '@/lib/types/types';
import { IS_MOBILE, MOBILE_SECTIONS } from '@/lib/utils/platform/platform';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { TIERS, isTierVisible } from '@/lib/constants/uiModes';
import { sections } from './sidebarData';
import { useSidebarLabels } from '@/i18n/useSidebarTranslation';
import { useTranslation } from '@/i18n/useTranslation';
import { useIsDarkTheme } from '@/stores/themeStore';

interface SidebarLevel1Props {
  collapsed: boolean;
  disabledSections: Set<SidebarSection>;
  onMobileDrawerToggle: (section: SidebarSection) => void;
  appVersion: string;
}

export default function SidebarLevel1({
  collapsed,
  disabledSections,
  onMobileDrawerToggle,
  appVersion,
}: SidebarLevel1Props) {
  const {
    sidebarSection,
    contextScanActive,
    contextScanComplete,
    creativeSessionRunning,
  } = useSystemStore(
    useShallow((s) => ({
      sidebarSection: s.sidebarSection,
      contextScanActive: s.contextScanActive,
      contextScanComplete: s.contextScanComplete,
      creativeSessionRunning: s.creativeSessionRunning,
    }))
  );
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setContextScanComplete = useSystemStore((s) => s.setContextScanComplete);
  const { pendingReviewCount, unreadMessageCount } = useBadgeCounts();
  const isExecuting = useAgentStore((s) => s.isExecuting);
  const buildPhase = useAgentStore((s) => s.buildPhase);
  const buildPersonaId = useAgentStore((s) => s.buildPersonaId);
  const isBuildingOrTesting = !!buildPersonaId && !!buildPhase && buildPhase !== 'initializing' && buildPhase !== 'promoted';
  const isDev = import.meta.env.DEV;
  const isDark = useIsDarkTheme();
  const tier = useTier();
  const labelOf = useSidebarLabels();
  const { t } = useTranslation();
  // Theme-synced L1 active: light uses stronger styling, dark uses subtler
  const l1ActiveClass = isDark
    ? 'bg-primary/10 border border-primary/20'
    : 'bg-primary/15 border border-primary/30 shadow-[0_0_12px_rgba(59,130,246,0.15)]';

  // Build badge definitions per section, ordered by priority (lower = higher).
  // Priority guide: 1 = count badges (actionable), 2 = executing, 3 = testing,
  // 4 = transforms, 5 = scan active, 6 = completion dots.
  const badgesBySection = useMemo(() => {
    const map: Partial<Record<SidebarSection, BadgeDefinition[]>> = {
      overview: [
        {
          id: 'pending-reviews',
          priority: 1,
          active: pendingReviewCount > 0,
          label: `${pendingReviewCount} pending review${pendingReviewCount !== 1 ? 's' : ''}`,
          variant: 'count',
          color: 'bg-amber-500 shadow-amber-500/30',
          count: pendingReviewCount,
        },
        {
          id: 'unread-messages',
          priority: 1,
          active: unreadMessageCount > 0,
          label: `${unreadMessageCount} unread message${unreadMessageCount !== 1 ? 's' : ''}`,
          variant: 'count',
          color: 'bg-blue-500 shadow-blue-500/30',
          count: unreadMessageCount,
        },
      ],
      personas: [
        {
          id: 'build-test',
          priority: 2,
          active: isBuildingOrTesting,
          label: buildPhase === 'testing' ? 'Testing agent' : 'Draft in progress',
          variant: 'pulse',
          color: 'bg-violet-500 border-violet-600/50',
          pingColor: 'bg-violet-500/40',
        },
        {
          id: 'executing',
          priority: 2,
          active: isExecuting,
          label: 'Execution in progress',
          variant: 'pulse',
          color: 'bg-blue-500 border-blue-600/50',
          pingColor: 'bg-blue-500/40',
        },
      ],
      // Templates: no indicators — adoption creates a draft, visible via Agents
      plugins: [
        {
          id: 'creative-session-active',
          priority: 2,
          active: creativeSessionRunning,
          label: 'Creative session in progress',
          variant: 'pulse',
          color: 'bg-orange-500 border-orange-600/50',
          pingColor: 'bg-orange-500/40',
        },
        {
          id: 'context-scan-active',
          priority: 5,
          active: contextScanActive,
          label: 'Context scan in progress',
          variant: 'pulse',
          color: 'bg-amber-500 border-amber-600/50',
          pingColor: 'bg-amber-500/40',
        },
        {
          id: 'context-scan-complete',
          priority: 6,
          active: !contextScanActive && contextScanComplete,
          label: 'Context scan complete',
          variant: 'dot',
          color: 'bg-emerald-500 border border-emerald-600/50',
          onClick: (e: React.MouseEvent) => { e.stopPropagation(); setContextScanComplete(false); },
        },
      ],
    };
    return map;
  }, [
    pendingReviewCount, unreadMessageCount, isExecuting,
    isBuildingOrTesting, buildPhase,
    contextScanActive, contextScanComplete,
    setContextScanComplete, creativeSessionRunning,
  ]);

  // Per-persona activity dots for Agents — one per task (draft / exec / lab).
  // Each dot is clickable to jump to that persona and hoverable for a tooltip.
  const agentActivities = useSidebarAgentActivity();

  return (
    <>
      <SidebarIconStyles />
      <div className={`${collapsed ? 'w-[52px]' : 'w-[88px]'} bg-secondary/40 border-r border-primary/15 flex flex-col items-center py-3 gap-1 transition-all duration-200`}>
        {sections
          .filter((s) => (!s.devOnly || isDev) && (!IS_MOBILE || MOBILE_SECTIONS.has(s.id)) && isTierVisible(s.minTier ?? TIERS.STARTER, tier.current))
          .map((section) => {
          const CustomIcon = SIDEBAR_ICONS[section.id];
          const FallbackIcon = section.icon;
          const isActive = sidebarSection === section.id;
          const isDisabled = disabledSections.has(section.id);
          const isDevSection = section.devOnly;
          const isDevModeSection = section.devModeOnly;

          return (
            <button
              key={section.id}
              data-testid={`sidebar-${section.id}`}
              onClick={() => {
                if (isDisabled) return;
                // Clear context scan complete indicator when navigating to plugins
                if (section.id === 'plugins' && contextScanComplete) {
                  setContextScanComplete(false);
                }
                if (IS_MOBILE) {
                  onMobileDrawerToggle(section.id);
                } else {
                  setSidebarSection(section.id);
                }
              }}
              disabled={isDisabled}
              className={`relative ${collapsed ? 'w-[40px]' : 'w-[76px]'} rounded-xl flex flex-col items-center justify-center py-2 transition-all group ${
                isDisabled ? 'cursor-not-allowed opacity-40' : ''
              } ${isDevSection ? 'ring-1 ring-amber-500/40' : ''} ${isDevModeSection ? 'ring-1 ring-amber-500/30' : ''}`}
              title={isDisabled ? `${labelOf(section.id, section.label)} (${t.sidebar.coming_soon})` : labelOf(section.id, section.label)}
              aria-label={isDisabled ? `${labelOf(section.id, section.label)} (${t.sidebar.coming_soon})` : labelOf(section.id, section.label)}
              aria-current={isActive ? 'page' : undefined}
            >
              {isActive && !isDisabled && (
                <motion.div
                  layoutId="sidebarSectionIndicator"
                  className={`absolute inset-0 rounded-xl ${l1ActiveClass}`}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              <div className={`relative z-10 ${collapsed ? 'w-6 h-6' : 'w-9 h-9'} transition-all ${
                isDisabled
                  ? 'text-foreground'
                  : isActive ? 'text-primary' : 'text-foreground group-hover:text-foreground'
              }`}>
                {CustomIcon
                  ? <CustomIcon active={isActive} className="w-full h-full" />
                  : <FallbackIcon className="w-full h-full" />
                }
              </div>
              {!collapsed && (
                <span className={`relative z-10 text-[10px] leading-tight mt-1 font-bold transition-colors ${
                  isActive ? 'text-primary' : 'text-foreground group-hover:text-foreground'
                }`}>
                  {labelOf(section.id, section.label)}
                </span>
              )}
              {isDisabled && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 z-20 px-1 py-px typo-label leading-none rounded bg-muted-foreground/15 text-foreground/90 whitespace-nowrap">
                  {t.sidebar.soon_badge}
                </span>
              )}
              {badgesBySection[section.id] != null && (
                <BadgeSlot badges={badgesBySection[section.id]!} />
              )}
              {section.id === 'personas' && agentActivities.length > 0 && (
                <OrbitDots activities={agentActivities} />
              )}
            </button>
          );
        })}

        <div className="flex-1" />

        {!collapsed && appVersion && (
          <div className="pb-1 pt-1">
            <span className="typo-code text-foreground/90 block text-center">
              v{appVersion}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
