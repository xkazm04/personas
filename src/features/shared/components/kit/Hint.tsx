import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

type Described = { 'aria-describedby'?: string; tabIndex?: number };

/**
 * Hint: the kit's explanation on a mark, a figure or a unit strip ("1 square = 5 runs", what a
 * glyph means). It is the app's shared Tooltip (placement, flip, Esc, the tooltip surface), with
 * the wiring the Tooltip cannot do from a box-less wrapper: the text is always in the tree as a
 * `hidden` node the trigger points at (`aria-describedby`, merged with any it has; a hidden
 * node still computes as a description), so a reader hears it once, without a hover, and never
 * twice in reading order. The trigger must forward `aria-describedby` (DOM elements, Mark and
 * UnitStrip do; a Dot is aria-hidden, so its meaning belongs in the text beside it). The trigger
 * is ONE element; its accessible NAME stays its own (a Mark's `label`, a UnitStrip's `label`): a
 * Hint only describes.
 *
 * `focusable` makes a standalone, non-interactive trigger a tab stop so a keyboard user can open
 * the tip too; leave it off inside rows and tables, where a stop per mark would bury the row's
 * one stop (keyboard-navigation-models: tab between widgets, not through every part). Never a
 * native `title=`.
 * @catalog Hint - the kit tip on a mark, figure or unit strip: shared Tooltip plus an always-present description. Kit.
 */
export function Hint({ content, focusable, placement = 'top', children }: {
  /** What the tip says; plain text (it is also the description a reader hears). */
  content: string;
  focusable?: boolean;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactElement<Described>;
}): ReactNode {
  const id = useId();
  if (!content || !isValidElement(children)) return children;
  const own = children.props['aria-describedby'];
  const trigger = cloneElement(children, {
    'aria-describedby': own ? `${own} ${id}` : id,
    ...(focusable ? { tabIndex: 0 } : null),
  });
  return (
    <>
      <Tooltip content={content} placement={placement}>{trigger}</Tooltip>
      <span id={id} hidden>{content}</span>
    </>
  );
}
