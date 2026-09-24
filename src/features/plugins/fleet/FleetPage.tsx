import { lazy, Suspense, useState } from 'react';
import { Terminal, LayoutDashboard, Settings as SettingsIcon, Activity, Unplug } from 'lucide-react';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { debtText } from '@/i18n/DebtText';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { silentCatch } from '@/lib/silentCatch';
import { useFleetOrphanScan } from './useFleetOrphanScan';
import { resumeAllOrphans } from './resumeAllOrphans';


const FleetGridPage = lazy(() => import('./sub_grid/FleetGridPage'));
const FleetActivityPage = lazy(() => import('./sub_activity/FleetActivityPage'));
const FleetSettingsPage = lazy(() => import('./sub_settings/FleetSettingsPage'));

type InternalTab = 'grid' | 'activity' | 'settings';

// Sessions is the home for every operation (spawn, kill, broadcast, terminal
// view). Activity is the cross-session transcript feed (F2/P2.2). Settings
// stays for hook uninstall + diagnostics; install lives in the Sessions pill.
const TABS: { id: InternalTab; label: string; icon: typeof Terminal }[] = [
  { id: 'grid', label: 'Sessions', icon: LayoutDashboard },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

/**
 * Fleet — Claude Code session aggregator, rendered as a Dev Tools sub-tab.
 *
 * Two internal tabs (Sessions / Settings) live inside one Dev Tools slot
 * rather than expanding the dev-tools sidebar. The active project (from the
 * dev-tools project picker) is the implicit cwd for any session spawned
 * here. The header also surfaces a "Show skills" toggle that replaces the
 * body with the relocated Skills browser (formerly its own Dev Tools tab),
 * giving Fleet operators inline access to the skill library without
 * leaving the session aggregator.
 */
export default function FleetPage() {
  const [tab, setTab] = useState<InternalTab>('grid');
  // Poll for orphaned Claude processes (registry is lost on restart) so the
  // Settings tab can badge them without the user opening Settings first.
  useFleetOrphanScan();
  const orphanCount = useSystemStore((s) => s.fleetOrphanCount);
  const setOrphanCount = useSystemStore((s) => s.fleetSetOrphanCount);
  const addToast = useToastStore((st) => st.addToast);
  const { t, tx } = useTranslation();
  const f = t.plugins.fleet;
  const [confirmResume, setConfirmResume] = useState(false);

  // The badge used to be a `<span>` inside the Settings tab button, which made
  // the only signal that a crash left terminals behind a decoration: adopting
  // them meant opening Settings and pressing Resume once per row. It is now its
  // OWN control beside the tabs - not nested inside the tab button, which would
  // be an interactive element inside an interactive element.
  const doResumeAll = async () => {
    setConfirmResume(false);
    try {
      const { attempted, resumed, failed } = await resumeAllOrphans();
      // A fresh scan runs inside `resumeAllOrphans`, so the count can legitimately
      // have dropped to zero since the badge last polled.
      if (attempted === 0) {
        setOrphanCount(0);
        addToast(f.orphans_resume_none, 'success');
        return;
      }
      setOrphanCount(attempted - resumed);
      if (failed.length === 0) {
        addToast(tx(f.orphans_resumed, { resumed, total: attempted }), 'success');
      } else {
        // Name the ones that did not make it. A bare "2 of 3" leaves the
        // operator with nothing to go look at.
        addToast(
          tx(f.orphans_resume_partial, {
            resumed,
            total: attempted,
            pids: failed.map((x) => x.pid).join(', '),
          }),
          resumed > 0 ? 'warning' : 'error',
        );
      }
    } catch (err) {
      silentCatch('features/plugins/fleet/FleetPage:resumeAllOrphans')(err);
      addToast(f.orphans_resume_failed, 'error');
    }
  };

  return (
    <div className="fleet-typescale h-full w-full flex flex-col" data-testid="fleet-page">
      {/* Internal tab strip — lightweight band above the active sub-page;
          each sub-page renders its own ContentBox/Header underneath. Skills
          now live in the left drawer (opened from the grid), not a tab. */}
      <div className="flex items-center gap-1 px-6 pt-5 pb-3 border-b border-primary/10">
        <Terminal className="w-5 h-5 text-primary mr-1" />
        <h1 className="typo-heading text-foreground mr-3">Fleet</h1>
        {TABS.map((tabDef) => {
          const Icon = tabDef.icon;
          const active = tab === tabDef.id;
          return (
            <button
              key={tabDef.id}
              type="button"
              data-testid={`fleet-tab-${tabDef.id}`}
              onClick={() => setTab(tabDef.id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-card text-[14px] transition-colors ${
                active
                  ? 'bg-primary/10 text-primary border border-primary/25'
                  : 'text-foreground hover:text-foreground hover:bg-secondary/40 border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tabDef.label}
            </button>
          );
        })}
        {orphanCount > 0 && (
          <button
            type="button"
            data-testid="fleet-orphan-badge"
            onClick={() => setConfirmResume(true)}
            title={f.orphans_resume_title}
            className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-orange-500/20 text-orange-300 text-[12px] leading-none hover:bg-orange-500/30 transition-colors"
          >
            <Unplug className="w-3 h-3" />
            {tx(orphanCount === 1 ? f.orphans_badge_one : f.orphans_badge_other, { count: orphanCount })}
          </button>
        )}
      </div>

      {confirmResume && (
        <ConfirmDialog
          title={f.orphans_resume_title}
          body={tx(
            orphanCount === 1 ? f.orphans_resume_body_one : f.orphans_resume_body_other,
            { count: orphanCount },
          )}
          confirmLabel={f.orphans_resume_confirm}
          onConfirm={doResumeAll}
          onCancel={() => setConfirmResume(false)}
        />
      )}

      <div
        data-testid={`fleet-active-${tab}`}
        key={tab}
        className="animate-fade-slide-in flex-1 min-h-0 flex flex-col"
      >
        <Suspense fallback={<SuspenseFallback />}>
          <>
            {tab === 'grid' && <FleetGridPage />}
            {tab === 'activity' && <FleetActivityPage onOpenSessions={() => setTab('grid')} />}
            {tab === 'settings' && <FleetSettingsPage />}
          </>
        </Suspense>
      </div>
    </div>
  );
}

// Retained for the three sub_*/page modules that still import it as a
// placeholder. Used only when a sub-page wants to surface "this surface
// isn't fully wired yet" while iterating; harmless to keep.
export function FleetPhaseBanner({ phase, summary }: { phase: string; summary: string }) {
  return (
    <ContentBox>
      <ContentHeader
        icon={<Terminal className="w-5 h-5 text-primary" />}
        title={debtText("auto_fleet_claude_code_session_aggregator_d33e41a2")}
        subtitle="Experimental — lives under Dev Tools, inherits the active project"
      />
      <ContentBody>
        <div className="border border-primary/20 rounded-modal bg-primary/5 px-4 py-3">
          <p className="typo-caption text-primary mb-1">{phase}</p>
          <p className="text-[14px] text-foreground leading-relaxed">{summary}</p>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
