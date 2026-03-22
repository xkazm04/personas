import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { SidebarIconStyles, SIDEBAR_ICONS } from './SidebarIcons';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useBadgeCounts } from '@/hooks/sidebar/useBadgeCounts';
import type { SidebarSection } from '@/lib/types/types';
import { IS_MOBILE, MOBILE_SECTIONS } from '@/lib/utils/platform/platform';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { TIERS, isTierVisible } from '@/lib/constants/uiModes';
import { sections } from './sidebarData';

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
    n8nTransformActive,
    templateAdoptActive,
    rebuildActive,
    templateTestActive,
    connectorTestActive,
    contextScanActive,
    contextScanComplete,
  } = useSystemStore(
    useShallow((s) => ({
      sidebarSection: s.sidebarSection,
      n8nTransformActive: s.n8nTransformActive,
      templateAdoptActive: s.templateAdoptActive,
      rebuildActive: s.rebuildActive,
      templateTestActive: s.templateTestActive,
      connectorTestActive: s.connectorTestActive,
      contextScanActive: s.contextScanActive,
      contextScanComplete: s.contextScanComplete,
    }))
  );
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setContextScanComplete = useSystemStore((s) => s.setContextScanComplete);
  const { pendingReviewCount } = useBadgeCounts();
  const isLabRunning = useAgentStore((s) => s.isLabRunning);
  const isDev = import.meta.env.DEV;
  const tier = useTier();

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
              title={isDisabled ? `${section.label} (Coming soon)` : section.label}
            >
              {isActive && !isDisabled && (
                <motion.div
                  layoutId="sidebarSectionIndicator"
                  className="absolute inset-0 rounded-xl bg-primary/15 border border-primary/30 shadow-[0_0_12px_rgba(59,130,246,0.15)]"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              <div className={`relative z-10 ${collapsed ? 'w-6 h-6' : 'w-9 h-9'} transition-all ${
                isDisabled
                  ? 'text-muted-foreground/50'
                  : isActive ? 'text-primary' : 'text-foreground/70 group-hover:text-foreground'
              }`}>
                {CustomIcon
                  ? <CustomIcon active={isActive} className="w-full h-full" />
                  : <FallbackIcon className="w-full h-full" />
                }
              </div>
              {!collapsed && (
                <span className={`relative z-10 text-[10px] leading-tight mt-1 font-bold transition-colors ${
                  isActive ? 'text-primary' : 'text-foreground/80 group-hover:text-foreground'
                }`}>
                  {section.label}
                </span>
              )}
              {isDisabled && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 z-20 px-1 py-px typo-label leading-none rounded bg-muted-foreground/15 text-muted-foreground/80 whitespace-nowrap">
                  soon
                </span>
              )}
              {section.id === 'overview' && pendingReviewCount > 0 && (
                <span className="absolute top-0.5 right-0.5 z-20 min-w-[16px] h-4 px-1 flex items-center justify-center typo-heading leading-none rounded-full bg-amber-500 text-white shadow-sm shadow-amber-500/30">
                  {pendingReviewCount > 99 ? '99+' : pendingReviewCount}
                </span>
              )}
              {section.id === 'design-reviews' && (n8nTransformActive || templateAdoptActive || rebuildActive || templateTestActive) && (
                <span className="absolute top-0.5 right-0.5 z-20 w-4 h-4 flex items-center justify-center">
                  <span className="absolute inset-0 rounded-full bg-amber-500/40 animate-ping" />
                  <span className="relative w-2.5 h-2.5 rounded-full bg-amber-500 border border-amber-600/50" />
                </span>
              )}
              {section.id === 'personas' && (isLabRunning || connectorTestActive) && (
                <span className="absolute top-0.5 right-0.5 z-20 w-4 h-4 flex items-center justify-center">
                  <span className="absolute inset-0 rounded-full bg-cyan-500/40 animate-ping" />
                  <span className="relative w-2.5 h-2.5 rounded-full bg-cyan-500 border border-cyan-600/50" />
                </span>
              )}
              {/* Plugins: pulsing amber while scanning, green when complete (click to dismiss) */}
              {section.id === 'plugins' && contextScanActive && (
                <span className="absolute top-0.5 right-0.5 z-20 w-4 h-4 flex items-center justify-center">
                  <span className="absolute inset-0 rounded-full bg-amber-500/40 animate-ping" />
                  <span className="relative w-2.5 h-2.5 rounded-full bg-amber-500 border border-amber-600/50" />
                </span>
              )}
              {section.id === 'plugins' && !contextScanActive && contextScanComplete && (
                <span
                  className="absolute top-0.5 right-0.5 z-20 w-4 h-4 flex items-center justify-center cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setContextScanComplete(false); }}
                >
                  <span className="relative w-2.5 h-2.5 rounded-full bg-emerald-500 border border-emerald-600/50" />
                </span>
              )}
            </button>
          );
        })}

        <div className="flex-1" />

        {!collapsed && appVersion && (
          <div className="pb-1 pt-1">
            <span className="typo-code text-muted-foreground/80 block text-center">
              v{appVersion}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
