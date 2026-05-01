import { Sparkles, Settings2 } from "lucide-react";
import type { BuildPhase } from "@/lib/types/buildTypes";
import { GlyphEditableName } from "./GlyphEditableName";

interface GlyphTopBarProps {
  agentName: string;
  onAgentNameChange: (v: string) => void;
  isPreBuild: boolean;
  isBuilding: boolean;
  buildPhase: BuildPhase | null;
  face: "glyph" | "edit";
  onFaceChange: (face: "glyph" | "edit") => void;
}

export function GlyphTopBar({
  agentName, onAgentNameChange, isPreBuild, isBuilding, buildPhase, face, onFaceChange,
}: GlyphTopBarProps) {
  return (
    <div className="w-full max-w-6xl flex items-center gap-3">
      <div className="flex-1" />
      <div className="flex flex-col items-center gap-0.5 flex-[2]">
        <GlyphEditableName
          value={agentName}
          onChange={onAgentNameChange}
          editable={!isPreBuild}
        />
        {isBuilding && buildPhase && (
          <span className="typo-caption text-foreground/40 italic">
            {buildPhase.replace(/_/g, " ")}…
          </span>
        )}
        {isPreBuild && (
          <span className="typo-caption text-foreground/40">
            Describe what you want — the sigil reveals your agent
          </span>
        )}
      </div>
      <div className="flex-1 flex justify-end">
        {!isPreBuild && (
          <div className="inline-flex rounded-full border border-border/30 bg-secondary/20 p-0.5">
            <button
              type="button"
              onClick={() => onFaceChange("glyph")}
              className={`rounded-full px-3 py-1 typo-caption flex items-center gap-1.5 transition ${
                face === "glyph" ? "bg-primary/20 text-primary" : "text-foreground/60 hover:text-foreground"
              }`}
              title="Glyph face"
            >
              <Sparkles className="w-3 h-3" /> Glyph
            </button>
            <button
              type="button"
              onClick={() => onFaceChange("edit")}
              className={`rounded-full px-3 py-1 typo-caption flex items-center gap-1.5 transition ${
                face === "edit" ? "bg-primary/20 text-primary" : "text-foreground/60 hover:text-foreground"
              }`}
              title="Advanced edit"
              data-testid="glyph-full-edit-face"
            >
              <Settings2 className="w-3 h-3" /> Edit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
