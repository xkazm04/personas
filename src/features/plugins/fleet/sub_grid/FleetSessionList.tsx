import type { RefObject } from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText } from '@/i18n/DebtText';
import { FleetSessionCard } from '../FleetSessionCard';
import { FleetSearchField } from './FleetSearchField';
import { stateText } from './fleetStateTone';
import type { FleetSessionGroup } from './useFleetGridNavigation';

interface FleetSessionListProps {
  sessions: FleetSession[];
  groups: FleetSessionGroup[];
  activeSessionId: string | null;
  hasProject: boolean;
  query: string;
  onQuery: (q: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onActivate: (id: string) => void;
  onRemovedLocal: (id: string) => void;
}

/**
 * The Sessions page's left column: a filter field over the sessions grouped by
 * lifecycle state (head, then rows). It scrolls inside the column, which takes
 * the page's height, so the terminal beside it fills the viewport instead of
 * growing and shrinking with the number of rows.
 */
export function FleetSessionList(p: FleetSessionListProps) {
  const { t, tx } = useTranslation();
  const f = t.plugins.fleet;
  const count = (n: number) => tx(n === 1 ? f.sessions_one : f.sessions_other, { count: n });

  return (
    <div data-testid="fleet-session-list" className="min-h-0 overflow-y-auto pr-1">
      {p.sessions.length > 1 && (
        <FleetSearchField
          ref={p.searchRef}
          className="mb-2"
          data-testid="fleet-session-search"
          value={p.query}
          onChange={p.onQuery}
          placeholder={f.search_placeholder}
        />
      )}
      {p.sessions.length === 0 ? (
        <div className="text-center py-8 px-3 border border-dashed border-primary/10 rounded-modal">
          <div className="w-10 h-10 rounded-modal bg-primary/8 border border-primary/15 flex items-center justify-center mx-auto mb-2">
            <TerminalIcon className="w-5 h-5 text-foreground" aria-hidden="true" />
          </div>
          <p className="typo-body text-foreground"><DebtText k="auto_no_sessions_yet_9d7789c9" /></p>
          <p className="typo-caption mt-1">
            {p.hasProject
              ? 'Click Spawn to launch claude, or run it externally once hooks are installed.'
              : 'Pick a project in Dev Tools → Projects.'}
          </p>
        </div>
      ) : p.groups.length === 0 ? (
        <div className="text-center py-6 typo-caption" data-testid="fleet-no-matches">
          {f.search_no_matches}
        </div>
      ) : (
        p.groups.map((g, idx) => {
          const GroupIcon = g.icon;
          const tone = stateText(g.id);
          return (
            <div
              key={g.id}
              data-testid={`fleet-group-${g.id}`}
              className={idx === 0 ? '' : 'pt-2 mt-2 border-t border-primary/10'}
            >
              <div className="flex items-center gap-1.5 px-2 mb-1">
                <GroupIcon className={`w-3.5 h-3.5 ${tone} ${g.id === 'running' ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span className="typo-label text-foreground">{f[g.labelKey]}</span>
                {/* The group name is the head's one emphasis; its count is a figure, regular weight. */}
                <span className={`ml-auto typo-label font-normal tabular-nums ${tone}`} aria-label={count(g.sessions.length)}>
                  {g.sessions.length}
                </span>
              </div>
              <div className="space-y-0.5">
                {g.sessions.map((s) => (
                  <FleetSessionCard
                    key={s.id}
                    session={s}
                    isActive={s.id === p.activeSessionId}
                    onActivate={p.onActivate}
                    onRemovedLocal={p.onRemovedLocal}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
