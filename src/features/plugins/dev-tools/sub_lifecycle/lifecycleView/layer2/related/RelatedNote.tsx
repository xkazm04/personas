// The live line under a step's backlog items: what the last read or decision
// of an item came to when it failed. Always mounted where it sits, so the text
// is announced when it arrives; empty, it takes no room.
import { LT } from '../../system/lcType';
import { useRelatedItem } from './relatedItem';

export function RelatedNote() {
  const { error } = useRelatedItem();
  return (
    <p role="status" className={`${LT.row} text-status-error empty:hidden ${error ? 'mt-2' : ''}`} data-testid="lc2-related-note">
      {error ?? ''}
    </p>
  );
}
