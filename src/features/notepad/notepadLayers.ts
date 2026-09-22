/**
 * Stacking levels INSIDE the notepad layer.
 *
 * The pad itself is `z-[200]`, portaled to `<body>` (`NotepadOverlayHost`). A
 * popover, bubble or menu the desk opens is portaled to `<body>` too — a
 * z-index inside the pad's transformed subtree would mean nothing — so it has
 * to state a level above the pad's own, or it paints underneath it.
 */
export const NOTEPAD_LAYER_Z = 200;
/** Card popovers, the quick-ask input and the card context menu. */
export const NOTEPAD_POPOVER_Z = NOTEPAD_LAYER_Z + 60;
