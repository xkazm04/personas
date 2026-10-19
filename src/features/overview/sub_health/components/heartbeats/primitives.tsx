import type { HealthGrade } from '@/stores/slices/overview/personaHealthSlice';
import { GRADE_THEME } from './model';

// ---------------------------------------------------------------------------
// Shared heartbeat primitives — extractable building blocks for the ledger.
// ---------------------------------------------------------------------------

export function GradeDot({ grade, className = '' }: { grade: HealthGrade; className?: string }) {
  const th = GRADE_THEME[grade];
  return <span className={`shrink-0 w-2 h-2 rounded-full ${th.dot} ring-2 ${th.ring} ${className}`} />;
}
