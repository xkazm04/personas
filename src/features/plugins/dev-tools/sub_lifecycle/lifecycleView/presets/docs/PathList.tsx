// A doc's paths in full, one line each: the references it names that are gone
// from the repo (copy only - there is nothing to open), or the sources that
// changed after it was written (open with the OS, or copy).
import { Button, CopyButton } from '@/features/shared/components/buttons';

import { useLifecycleViewModel } from '../../context';
import { Count } from '../../system/Count';
import { RHYTHM } from '../../system/lcSurface';
import { LT } from '../../system/lcType';

interface PathListProps {
  title: string;
  paths: string[];
  /** Present = each path can be opened; a gone reference passes none. */
  onOpen?: (path: string) => void;
  /** The ink of the paths' marker (a gone reference is an error, a changed source a warning). */
  ink: string;
  testId: string;
}

export function PathList({ title, paths, onOpen, ink, testId }: PathListProps) {
  const { dl } = useLifecycleViewModel();
  return (
    <div className={RHYTHM.tight} data-testid={testId}>
      <p className={`flex items-center gap-2 ${LT.label}`}>
        <span className={ink}>{title}</span>
        <Count value={paths.length} />
      </p>
      <ul className="space-y-0.5">
        {paths.map((p) => (
          <li key={p} className="flex min-w-0 items-center gap-2">
            <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-pill bg-current ${ink}`} />
            <span className={`min-w-0 flex-1 break-all ${LT.code}`}>{p}</span>
            {onOpen && (
              <Button variant="ghost" size="xs" onClick={() => onOpen(p)} data-testid={`${testId}-open-${p}`}>
                {dl.lcx7_open}
              </Button>
            )}
            <CopyButton text={p} tooltip={dl.lcx7_copy_path} />
          </li>
        ))}
      </ul>
    </div>
  );
}
