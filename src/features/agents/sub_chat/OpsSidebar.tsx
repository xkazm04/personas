import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { MessageSquare, Play, FlaskConical, Activity, ShieldCheck } from 'lucide-react';
import { SessionSidebar } from './SessionSidebar';
import { useTranslation } from '@/i18n/useTranslation';

const OpsRunPanel = lazy(() => import('./panels/OpsRunPanel'));
const OpsLabPanel = lazy(() => import('./panels/OpsLabPanel'));
const OpsHealthPanel = lazy(() => import('./panels/OpsHealthPanel'));
const OpsAssertionsPanel = lazy(() => import('./panels/OpsAssertionsPanel'));

// ── Panel types ────────────────────────────────────────────────────────

export type OpsPanel = 'sessions' | 'run' | 'lab' | 'health' | 'assertions';

interface PanelDef {
  id: OpsPanel;
  icon: typeof MessageSquare;
  label: string;
  color: string;
}

function usePanels(): PanelDef[] {
  const { t } = useTranslation();
  return [
    { id: 'sessions', icon: MessageSquare, label: t.agents.ops.sessions, color: 'text-primary' },
    { id: 'run', icon: Play, label: t.agents.ops.run, color: 'text-emerald-400' },
    { id: 'lab', icon: FlaskConical, label: t.agents.ops.lab, color: 'text-violet-400' },
    { id: 'health', icon: Activity, label: t.agents.ops.health, color: 'text-amber-400' },
    { id: 'assertions', icon: ShieldCheck, label: t.agents.ops.assertions, color: 'text-cyan-400' },
  ];
}

// ── Badge props for icon rail ──────────────────────────────────────────

export interface OpsBadges {
  run?: { active: boolean };
  health?: { issueCount: number };
  assertions?: { failCount: number };
}

// ── OpsSidebar ─────────────────────────────────────────────────────────

interface OpsSidebarProps {
  personaId: string;
  onNewSession: () => void;
  badges?: OpsBadges;
}

const PANEL_ORDER: OpsPanel[] = ['sessions', 'run', 'lab', 'health', 'assertions'];

export function OpsSidebar({ personaId, onNewSession, badges }: OpsSidebarProps) {
  const { t, tx } = useTranslation();
  const PANELS = usePanels();
  const [activePanel, setActivePanel] = useState<OpsPanel>('sessions');

  const handlePanelClick = useCallback((id: OpsPanel) => {
    setActivePanel((prev) => (prev === id && id !== 'sessions' ? 'sessions' : id));
  }, []);

  // Keyboard shortcuts: Ctrl+1-5 switch panels
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= PANEL_ORDER.length) {
        e.preventDefault();
        setActivePanel(PANEL_ORDER[num - 1]!);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex h-full w-[28rem] border-r border-primary/[0.08]" data-testid="ops-sidebar">
      {/* Icon rail */}
      <div className="w-11 flex-shrink-0 border-r border-primary/[0.06] flex flex-col items-center py-2 gap-1 bg-secondary/[0.03]">
        {PANELS.map((panel) => {
          const Icon = panel.icon;
          const isActive = activePanel === panel.id;
          const badge = getBadge(panel.id, badges);
          return (
            <button
              key={panel.id}
              onClick={() => handlePanelClick(panel.id)}
              data-testid={`ops-panel-btn-${panel.id}`}
              title={panel.label}
              aria-label={tx(t.agents.ops.switch_panel, { panel: panel.label })}
              className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 focus-ring ${
                isActive
                  ? `bg-primary/12 ${panel.color}`
                  : 'text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-primary/5'
              }`}
            >
              <Icon className="w-4 h-4" />
              {badge && (
                <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-background ${badge.color}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Panel content */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        {activePanel === 'sessions' ? (
          <SessionSidebar personaId={personaId} onNewSession={onNewSession} />
        ) : (
          <Suspense fallback={<PanelLoadingFallback />}>
            <div className="flex-1 overflow-y-auto" data-testid={`ops-panel-content-${activePanel}`}>
              {activePanel === 'run' && <OpsRunPanel personaId={personaId} />}
              {activePanel === 'lab' && <OpsLabPanel personaId={personaId} />}
              {activePanel === 'health' && <OpsHealthPanel personaId={personaId} />}
              {activePanel === 'assertions' && <OpsAssertionsPanel personaId={personaId} />}
            </div>
          </Suspense>
        )}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function getBadge(id: OpsPanel, badges?: OpsBadges): { color: string } | null {
  if (!badges) return null;
  if (id === 'run' && badges.run?.active) return { color: 'bg-emerald-400 animate-pulse' };
  if (id === 'health' && badges.health && badges.health.issueCount > 0) return { color: 'bg-amber-400' };
  if (id === 'assertions' && badges.assertions && badges.assertions.failCount > 0) return { color: 'bg-red-400' };
  return null;
}

function PanelLoadingFallback() {
  return (
    <div className="flex items-center justify-center h-32">
      <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );
}
