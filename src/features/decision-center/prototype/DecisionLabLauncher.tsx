/**
 * Dev-only launcher for the Decision Center prototype Lab (Track B). Renders
 * nothing in production builds; the consolidation package deletes it.
 */
import { Suspense, useState } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { FullScreenOverlay } from '@/features/shared/components/layout/FullScreenOverlay';

const DecisionPrototypeLab = lazyRetry(() => import('./DecisionPrototypeLab'));

export function DecisionLabLauncher() {
  const [open, setOpen] = useState(false);
  if (!import.meta.env.DEV) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} data-testid="decision-lab-open" aria-label="Decision Center prototype lab">
        <FlaskConical className="h-4 w-4" aria-hidden />
      </Button>
      {open && (
        <FullScreenOverlay onClose={() => setOpen(false)} ariaLabel="Decision Center prototype lab" testId="decision-lab">
          <Suspense fallback={null}>
            <DecisionPrototypeLab />
          </Suspense>
        </FullScreenOverlay>
      )}
    </>
  );
}
