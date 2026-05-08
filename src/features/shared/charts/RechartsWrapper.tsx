import { Suspense, lazy, type ReactNode } from 'react';

// Render-prop API instead of per-component React.lazy wrappers because recharts
// inspects child component identity (e.g. `child.type === Bar`) — a Suspense-wrapped
// child fails that check. A single dynamic import gives us one shared chunk and lets
// consumers compose normally with the resolved module.

export type RechartsModule = typeof import('recharts');

interface LazyRechartsContentProps {
  render: (R: RechartsModule) => ReactNode;
}

const LazyRechartsContent = lazy(async () => {
  const recharts = await import('recharts');
  function LazyRechartsRenderer({ render }: LazyRechartsContentProps) {
    return <>{render(recharts)}</>;
  }
  return { default: LazyRechartsRenderer };
});

interface LazyChartProps {
  render: (R: RechartsModule) => ReactNode;
  fallback?: ReactNode;
}

export function LazyChart({ render, fallback = null }: LazyChartProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyRechartsContent render={render} />
    </Suspense>
  );
}
