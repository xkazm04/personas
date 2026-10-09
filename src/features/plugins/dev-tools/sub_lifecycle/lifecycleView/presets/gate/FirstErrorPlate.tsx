/**
 * A run's first error line on its own plate at the top of the run viewer, in
 * the error ink. With the output read and the line found in it, the plate
 * carries the way to it (`onJump`), which scrolls the output there.
 */
import { CornerDownRight } from 'lucide-react';

import { KitButton } from '@/features/shared/components/kit';

import { useLifecycleViewModel } from '../../context';
import { lcSurface } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';

export function FirstErrorPlate({ text, onJump }: { text: string | null; onJump?: () => void }) {
  const { dl } = useLifecycleViewModel();
  if (!text) return null;
  return (
    <div className={`flex items-start gap-3 ${lcSurface('plate', 'border border-status-error/40 bg-status-error/5')}`} data-testid="lc6-viewer-first-error">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`${LT.label} text-status-error`}>{dl.lcx6_first_error}</span>
        <span className={`break-all ${LT.code}`}>{text}</span>
      </div>
      {onJump && (
        <KitButton tone="quiet" icon={<CornerDownRight className={GLYPH.sm} />} onClick={onJump} testId="lc6-go-error">
          {dl.lcx6_go_error}
        </KitButton>
      )}
    </div>
  );
}
