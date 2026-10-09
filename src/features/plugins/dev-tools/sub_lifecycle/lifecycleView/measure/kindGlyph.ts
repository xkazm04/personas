// The glyph of a command's kind, on a Measure's rows and chips: what the
// command checks, legible before its text is read.
import { Braces, FlaskConical, ListChecks, ScanSearch, ShieldCheck, SquareTerminal, type LucideIcon } from 'lucide-react';

import type { LifecycleGateKind } from '@/lib/bindings/LifecycleGateKind';

export const KIND_GLYPH: Record<LifecycleGateKind, LucideIcon> = {
  lint: ScanSearch,
  typecheck: Braces,
  test: FlaskConical,
  check: ListChecks,
  coverage: ShieldCheck,
  other: SquareTerminal,
};
