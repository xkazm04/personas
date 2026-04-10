import { LoadingSpinner } from './LoadingSpinner';

interface SuspenseFallbackProps {
  label?: string;
}

/** Lightweight centered spinner for use as a Suspense fallback. */
export function SuspenseFallback({ label }: SuspenseFallbackProps) {
  return (
    <div className="flex flex-1 items-center justify-center py-12 text-foreground">
      <LoadingSpinner size="lg" label={label ?? 'Loading'} />
    </div>
  );
}
