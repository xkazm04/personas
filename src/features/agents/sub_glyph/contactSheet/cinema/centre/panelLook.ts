/** How the centre's action panel is drawn. Cinema's own is the raised card
 *  ("card"); a layout with a drafting idiom (the Schematic Dial) provides
 *  "drafting" around its hub, and the ActionPanel and its Slate redraw
 *  themselves as a drafted title block: hairline frame with corner ticks,
 *  no raised surface, a tighter rhythm. The content and every testid stay
 *  the same in both, so the build flow cannot tell them apart. */
import { createContext, useContext } from "react";

export type PanelLook = "card" | "drafting";

export const PanelLookContext = createContext<PanelLook>("card");

export const usePanelLook = () => useContext(PanelLookContext);
