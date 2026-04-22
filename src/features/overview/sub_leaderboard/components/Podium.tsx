import { useMemo } from 'react';
import type { LeaderboardEntry, Medal } from '../libs/leaderboardScoring';
import { PodiumStep } from './PodiumStep';

interface PodiumProps {
  entries: LeaderboardEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function Podium({ entries, selectedId, onSelect }: PodiumProps) {
  const { gold, silver, bronze } = useMemo(() => {
    const byMedal = (m: Medal) => entries.find((e) => e.medal === m) ?? null;
    return {
      gold: byMedal('gold'),
      silver: byMedal('silver'),
      bronze: byMedal('bronze'),
    };
  }, [entries]);

  return (
    <div className="relative pt-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-8 h-96 opacity-70"
        style={{
          background:
            'radial-gradient(ellipse at center top, rgba(251,191,36,0.15) 0%, rgba(251,191,36,0.04) 40%, transparent 70%)',
        }}
      />
      <div className="relative flex flex-col md:flex-row items-end justify-center gap-4 md:gap-6">
        {silver && (
          <PodiumStep
            entry={silver}
            slot="silver"
            selected={selectedId === silver.personaId}
            onClick={() => onSelect(silver.personaId)}
          />
        )}
        {gold && (
          <PodiumStep
            entry={gold}
            slot="gold"
            selected={selectedId === gold.personaId}
            onClick={() => onSelect(gold.personaId)}
          />
        )}
        {bronze && (
          <PodiumStep
            entry={bronze}
            slot="bronze"
            selected={selectedId === bronze.personaId}
            onClick={() => onSelect(bronze.personaId)}
          />
        )}
      </div>
    </div>
  );
}
