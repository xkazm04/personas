/** useCinemaCast — the Cinema casting call, held at the sheet level because
 *  its outcome colours the whole sheet: the crowned candidate's colour becomes
 *  the sheet accent (rail, sigil core, title card). The winner is chosen per
 *  build session, so two builds do not crown the same face. */
import { useMemo } from "react";
import { makeCandidates, useCasting, DEFAULT_ACCENT, type Candidate } from "./cinemaMotion";

const COUNT = 12;
const FLOOR = 3;
const CASTING_MS = 28000;

function seedOf(s: string | null): number {
  if (!s) return 0;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function useCinemaCast(sessionId: string | null, crown: boolean, active: boolean) {
  const candidates = useMemo<Candidate[]>(() => makeCandidates(COUNT), []);
  // Elimination order: the session's winner first, the rest rotated after it.
  const ids = useMemo(() => {
    const start = seedOf(sessionId) % COUNT;
    return candidates.map((_, i) => candidates[(start + i) % COUNT]!.id);
  }, [candidates, sessionId]);
  const cast = useCasting(ids, crown, FLOOR, CASTING_MS, !active);
  const winner = candidates.find((c) => c.id === (cast.winner ?? ids[0])) ?? candidates[0]!;
  return {
    candidates,
    phase: cast.phase,
    eliminated: cast.eliminated,
    finalists: cast.finalists,
    winner,
    accent: cast.phase === "crowned" ? winner.color : DEFAULT_ACCENT,
  };
}

export type CinemaCast = ReturnType<typeof useCinemaCast>;
