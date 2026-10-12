/** The blueprint kit (spark onboarding-blueprint, prototype round): what the
 *  three persona-build variants share from Studio's drafting sheet. Studio's
 *  files are imported, never edited. Wrap a variant's root in `bp-root` (from
 *  ./blueprint.css) so the pen and the hatch read Cinema-toned ink. */
import "@/features/studio/guide/drafting/drafting.css";
import "./blueprint.css";

export { default as BlueprintPen } from "@/features/studio/guide/drafting/DraftingPen";
export { LETTERING } from "@/features/studio/guide/drafting/draftingModel";
export { useDraftSteps, DRAFT_STEP_MS } from "./useDraftSteps";
