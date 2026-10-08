// One line of text, ghosted: a box exactly one line of the given TYPE ROLE tall
// (`1lh` of that role), holding a calm bar a little shorter than the line, as
// glyphs are. A ghost built from these lines is as tall as the text it stands
// in for, so the swap to data moves nothing, and stacked lines read as lines
// rather than one block.
import { Ghost } from '@/features/shared/components/kit';

import type { TypeRole } from './lcType';
import { LT } from './lcType';

export function GhostLine({ role, width }: { role: TypeRole; width: string }) {
  return (
    <span className={`flex max-w-full items-center ${LT[role]}`} style={{ width, height: '1lh' }}>
      <Ghost width="100%" height="0.62lh" />
    </span>
  );
}
