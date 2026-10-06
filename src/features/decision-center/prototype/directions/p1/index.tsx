/**
 * Prototype direction p1 — placeholder committed by WP0 so the Lab compiles.
 * The direction's builder replaces this file's Hub with the real one.
 */
import type { HubProps, PrototypeDirection } from '../../directionContract';

function Hub({ items }: HubProps) {
  return <div className="p-6 typo-body text-foreground">{items.length}</div>;
}

const direction: PrototypeDirection = {
  id: 'p1',
  name: 'p1',
  tagline: '',
  Hub,
};

export default direction;
