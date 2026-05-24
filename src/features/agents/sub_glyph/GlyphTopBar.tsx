import { Sparkles, Settings2 } from "lucide-react";
import type { BuildPhase } from "@/lib/types/buildTypes";
import { debtText } from '@/i18n/DebtText';


interface GlyphTopBarProps {
  agentName: string;
  onAgentNameChange: (v: string) => void;
  isPreBuild: boolean;
  isBuilding: boolean;
  buildPhase: BuildPhase | null;
  face: "glyph" | "edit";
  onFaceChange: (face: "glyph" | "edit") => void;
  /** When true, the Edit toggle is locked. The user is in the middle of
   *  the questionnaire on the Glyph face — switching to Edit hides the
   *  question UI and the user reported losing track of in-flight
   *  questions ("questionnaire was skipped on switch"). Disabling the
   *  toggle until the question is answered keeps the flow intact. */
  editLocked?: boolean;
}

/** Slim chrome above the sigil. The agent name, pre-build prompt, and
 *  building-phase indicator were all removed from here — the centre of
 *  the sigil already carries that information ("Click to Begin",
 *  completeness %, phase label). What remains is the face switcher
 *  (Glyph ⇄ Edit) which is genuine wizard chrome with no in-sigil
 *  alternative. */
export function GlyphTopBar({
  isPreBuild, face, onFaceChange, editLocked,
}: GlyphTopBarProps) {
  if (isPreBuild) return null;
  return (
    <div className="w-full max-w-6xl flex items-center justify-end gap-3">
      <div className="inline-flex rounded-full border border-border/30 bg-secondary/20 p-0.5">
        <button
          type="button"
          onClick={() => onFaceChange("glyph")}
          className={`rounded-full px-3 py-1 typo-caption flex items-center gap-1.5 transition ${
            face === "glyph" ? "bg-primary/20 text-primary" : "text-foreground hover:text-foreground"
          }`}
          title={debtText("auto_glyph_face_8225d4a3")}
        >
          <Sparkles className="w-3 h-3" /> Glyph
        </button>
        <button
          type="button"
          onClick={() => onFaceChange("edit")}
          disabled={editLocked}
          className={`rounded-full px-3 py-1 typo-caption flex items-center gap-1.5 transition ${
            face === "edit" ? "bg-primary/20 text-primary" : "text-foreground hover:text-foreground"
          } ${editLocked ? "opacity-40 cursor-not-allowed" : ""}`}
          title={editLocked ? "Finish answering pending questions first" : "Advanced edit"}
          data-testid="glyph-full-edit-face"
        >
          <Settings2 className="w-3 h-3" /> Edit
        </button>
      </div>
    </div>
  );
}
