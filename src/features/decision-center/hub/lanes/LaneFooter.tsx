/**
 * The lane peek's extra walk keys: the ones that jump straight to a lane. The
 * peek's footer prints them after its arrows and before the word "lanes".
 */
import { Keycap } from '../../deck/parts';

export function LaneFooter() {
  return (
    <>
      <Keycap className="ml-2">1</Keycap>–<Keycap>4</Keycap>
      <Keycap>O</Keycap>
    </>
  );
}
