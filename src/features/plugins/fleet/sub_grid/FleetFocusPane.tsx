import type { ReactNode } from 'react';
import { Terminal as TerminalIcon, LayoutGrid, Moon, Sun, BarChart3 } from 'lucide-react';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { Button } from '@/features/shared/components/buttons';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText } from '@/i18n/DebtText';
import { FleetTerminalPane } from '../FleetTerminalPane';
import { sessionAttention, attentionClass } from '../fleetAttention';
import { FleetSessionInsights } from './FleetSessionInsights';
import { FleetPaneToolbar, type FleetRightView } from './FleetPaneToolbar';
import { stateText } from './fleetStateTone';

// The pane's frame sits on the page ground (`bg-background`). It was the dark
// terminal field as a raw `bg-[#0a0a0c]` in every theme, so in a light theme
// its toolbar, the Insights panel and the placeholders drew dark ink on near
// black. The terminal itself still paints its own field (FleetTerminalPane).
const FRAME = 'h-full border rounded-modal bg-background';

const VIEW_ID = 'fleet-pane-view';
const RIGHTVIEW_TESTID = 'fleet-rightview';

function Placeholder({ testId, icon, border = 'border-primary/10', children }: {
  testId?: string; icon: ReactNode; border?: string; children: ReactNode;
}) {
  return (
    <div data-testid={testId} className={`${FRAME} ${border} flex flex-col items-center justify-center gap-1 p-6 text-center text-foreground`}>
      <span className="mb-2 flex" aria-hidden="true">{icon}</span>
      {children}
    </div>
  );
}

interface FleetFocusPaneProps {
  session: FleetSession | null;
  gridOpen: boolean;
  view: FleetRightView;
  onView: (v: FleetRightView) => void;
  onCompact: (id: string) => void;
  onOpenSkills: () => void;
  onHibernate: (id: string) => void;
  onWake: (id: string) => void;
}

/**
 * The Sessions page's right column: the focused session's terminal (or its
 * Insights), or a placeholder when the grid overlay holds the terminals, the
 * session is hibernated, or nothing is focused. While the fullscreen grid is
 * open this pane unmounts its terminal so the two never contend for the same
 * managed terminal's holder.
 */
export function FleetFocusPane({ session, gridOpen, view, onView, onCompact, onOpenSkills, onHibernate, onWake }: FleetFocusPaneProps) {
  const { t } = useTranslation();
  const f = t.plugins.fleet;

  if (gridOpen) {
    return (
      <Placeholder icon={<LayoutGrid className="w-10 h-10 text-primary" />}>
        <p className="typo-caption">{f.grid_active_hint}</p>
      </Placeholder>
    );
  }
  if (!session) {
    return (
      <Placeholder icon={<TerminalIcon className="w-10 h-10" />}>
        <p className="typo-caption"><DebtText k="auto_select_a_session_to_view_its_terminal_921aba6c" /></p>
      </Placeholder>
    );
  }
  if (session.state === 'hibernated') {
    return (
      <Placeholder testId="fleet-hibernated-panel" icon={<Moon className={`w-10 h-10 ${stateText('hibernated')}`} />}>
        <p className="typo-heading text-foreground">{f.hibernated_panel_title}</p>
        <p className="typo-caption max-w-[340px] mb-3">{f.hibernated_panel_desc}</p>
        <Button variant="primary" size="sm" icon={<Sun className="w-3.5 h-3.5" />} data-testid="fleet-wake" onClick={() => onWake(session.id)}>
          {f.wake_session}
        </Button>
      </Placeholder>
    );
  }

  // The Terminal / Insights switch (SegmentedTabs; two hand-rolled toggle
  // buttons before) and the panel it selects, declared as a tab pair.
  const switcher = (
    <SegmentedTabs
      idPrefix={VIEW_ID}
      tabs={[
        { id: 'terminal' as const, label: <><TerminalIcon className="w-3.5 h-3.5" />{f.view_terminal}</>, testId: `${RIGHTVIEW_TESTID}-terminal` },
        { id: 'insights' as const, label: <><BarChart3 className="w-3.5 h-3.5" />{f.view_insights}</>, testId: `${RIGHTVIEW_TESTID}-insights` },
      ]}
      activeTab={view}
      onTabChange={onView}
      size="sm"
      fullWidth={false}
    />
  );

  return (
    <div className={`${FRAME} flex flex-col overflow-hidden ${attentionClass(sessionAttention(session)) || 'border-primary/10'}`}>
      <FleetPaneToolbar session={session} switcher={switcher} onCompact={onCompact} onOpenSkills={onOpenSkills} onHibernate={onHibernate} />
      <div className="flex-1 min-h-0" role="tabpanel" id={`${VIEW_ID}-panel-${view}`} aria-labelledby={`${VIEW_ID}-tab-${view}`}>
        {view === 'insights' ? (
          <FleetSessionInsights claudeSessionId={session.claudeSessionId} />
        ) : session.state === 'exited' ? (
          <div className="h-full flex flex-col items-center justify-center gap-1 p-6 text-foreground">
            <p className="typo-heading"><DebtText k="auto_session_exited_a34ee64f" /></p>
            <p className="typo-caption">
              {session.exitCode !== null ? `Exit code ${session.exitCode}` : 'Process exited unexpectedly'}
            </p>
          </div>
        ) : session.mode === 'headless' ? (
          // Headless sessions have no TTY, so there is nothing an xterm could
          // attach to: show the transcript rollup; replies go through the
          // Needs-you banner or Athena.
          <div className="h-full flex flex-col min-h-0" data-testid="fleet-headless-pane">
            <p className="shrink-0 px-3 py-2 typo-caption border-b border-primary/10">{f.headless_no_terminal}</p>
            <div className="flex-1 min-h-0">
              <FleetSessionInsights claudeSessionId={session.claudeSessionId} />
            </div>
          </div>
        ) : (
          <FleetTerminalPane sessionId={session.id} />
        )}
      </div>
    </div>
  );
}
