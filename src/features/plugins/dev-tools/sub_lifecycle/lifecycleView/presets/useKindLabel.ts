// A gate command kind's display name.
import type { LifecycleGateKind } from '@/lib/bindings/LifecycleGateKind';

import { useLifecycleViewModel } from '../context';

export function useKindLabel() {
  const { dl } = useLifecycleViewModel();
  return (kind: LifecycleGateKind): string => {
    switch (kind) {
      case 'lint': return dl.lc2_kind_lint;
      case 'typecheck': return dl.lc2_kind_typecheck;
      case 'test': return dl.lc2_kind_test;
      case 'check': return dl.lc2_kind_check;
      case 'coverage': return dl.lc2_kind_coverage;
      case 'other': return dl.lc2_kind_other;
    }
  };
}
