import type { ReactNode } from 'react';
import { BookOpen, Moon } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { FleetContextPill } from './FleetContextPill';

export type FleetRightView = 'terminal' | 'insights';

interface FleetPaneToolbarProps {
  session: FleetSession;
  /** The Terminal / Insights switch; rendered by the pane that owns the panel it selects. */
  switcher: ReactNode;
  onCompact: (id: string) => void;
  onOpenSkills: () => void;
  onHibernate: (id: string) => void;
}

/**
 * The focused session's toolbar: the Terminal / Insights switch (passed in by
 * FleetFocusPane, which owns the panel it selects), the context-size pill with
 * its inline Compact, and the Skills and Hibernate actions.
 */
export function FleetPaneToolbar({ session, switcher, onCompact, onOpenSkills, onHibernate }: FleetPaneToolbarProps) {
  const { t } = useTranslation();
  const f = t.plugins.fleet;
  const canCompact = session.state === 'idle' || session.state === 'awaiting_input' || session.state === 'stale';

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 border-b border-primary/10 shrink-0">
      {switcher}
      <FleetContextPill
        claudeSessionId={session.claudeSessionId}
        sessionId={session.id}
        canCompact={canCompact}
        onCompact={onCompact}
      />
      <div className="ml-auto flex items-center gap-1">
        <Tooltip content={f.skills_drawer_title}>
          <Button variant="ghost" size="sm" data-testid="fleet-open-skills" icon={<BookOpen className="w-3.5 h-3.5" />} onClick={onOpenSkills}>
            {f.skills_button}
          </Button>
        </Tooltip>
        <Button
          variant="ghost"
          size="sm"
          data-testid="fleet-sleep"
          icon={<Moon className="w-3.5 h-3.5" />}
          disabled={!session.claudeSessionId}
          disabledReason={f.sleep_unavailable}
          onClick={() => onHibernate(session.id)}
        >
          {f.sleep_session}
        </Button>
      </div>
    </div>
  );
}
